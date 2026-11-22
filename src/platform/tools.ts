/**
 * The tool registry: the one way anything changes in the instance.
 *
 * A screen, an API client and an agent all call `invoke()` with a principal,
 * a tool name and an input. In return for going through this single door they
 * get validation, a permission check, the autonomy dial (agents only), a
 * transaction, domain events and an audit row, with nothing to remember.
 */
import { and, count, eq, gte, isNull, or } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/db/client";
import { sysAudit, sysPolicy, task, type AuditStatus, type AutonomyLevel } from "@/db/schema";
import { emit } from "./events";
import { nextNumber } from "./numbers";
import { enqueue, type Enqueue } from "./outbox";
import type { Permission } from "./permissions";
import { loadPrincipal, type Principal } from "./principal";

/**
 * read / write stay inside the instance. external is seen by people outside
 * it (a message, going live). destructive cannot be undone. The last two are
 * held for approval when an agent calls them, unless a policy says otherwise.
 */
export type Risk = "read" | "write" | "external" | "destructive";

export type ToolContext = {
  /** The open transaction. Everything a handler does commits or rolls back together. */
  db: Db;
  principal: Principal;
  emit: (name: string, payload: Record<string, unknown>) => Promise<void>;
  enqueue: (message: Enqueue) => Promise<string | null>;
};

export type Tool<I extends z.ZodType = z.ZodType, O = unknown> = {
  name: string;
  description: string;
  permission: Permission;
  risk: Risk;
  input: I;
  /** Input and output fields that must never reach the audit ledger, such as a password or a signing secret. */
  redact?: string[];
  handler: (ctx: ToolContext, input: z.infer<I>) => Promise<O>;
};

/** Thrown by a handler to refuse a call for a reason the caller should see. */
export class ToolError extends Error {
  constructor(public code: string, message: string) {
    super(message);
  }
}

const registry = new Map<string, Tool>();

function redacted(input: unknown, keys?: string[]): unknown {
  if (!keys?.length || typeof input !== "object" || input === null) return input;
  const copy: Record<string, unknown> = { ...(input as Record<string, unknown>) };
  for (const key of keys) if (key in copy) copy[key] = "[redacted]";
  return copy;
}

export function defineTool<I extends z.ZodType, O>(tool: Tool<I, O>): Tool<I, O> {
  if (registry.has(tool.name)) throw new Error(`Tool ${tool.name} is already defined`);
  registry.set(tool.name, tool as unknown as Tool);
  return tool;
}

export const listTools = (): Tool[] => [...registry.values()];
export const getTool = (name: string): Tool | undefined => registry.get(name);

/** The catalogue as JSON Schema: what the API documents and what a model is given. */
export function toolCatalog() {
  return listTools().map((t) => ({
    name: t.name,
    description: t.description,
    permission: t.permission,
    risk: t.risk,
    inputSchema: z.toJSONSchema(t.input, { io: "input" }),
  }));
}

export type InvokeResult<O = unknown> =
  | { status: "ok"; output: O }
  | { status: "pending_approval"; approval: { id: string; number: string } }
  | { status: "denied"; reason: string }
  | { status: "invalid"; issues: { path: string; message: string }[] }
  | { status: "error"; code: string; message: string };

type InvokeOptions = { runId?: string; approvedBy?: string };

async function audit(
  db: Db, principal: Principal, tool: string, status: AuditStatus,
  fields: { input?: unknown; result?: unknown; error?: string } & InvokeOptions,
): Promise<void> {
  await db.insert(sysAudit).values({
    actorId: principal.id, actorKind: principal.kind, tool, status,
    input: fields.input ?? null, result: fields.result ?? null, error: fields.error ?? null,
    runId: fields.runId ?? null, approvedBy: fields.approvedBy ?? null,
  });
}

/** Where the dial sits for this agent on this tool. The most specific policy row wins. */
async function autonomyFor(db: Db, principal: Principal, tool: Tool): Promise<AutonomyLevel> {
  const rows = await db
    .select()
    .from(sysPolicy)
    .where(
      and(
        or(eq(sysPolicy.userId, principal.id), isNull(sysPolicy.userId)),
        or(eq(sysPolicy.tool, tool.name), eq(sysPolicy.tool, "*")),
      ),
    );
  const rank = (r: (typeof rows)[number]) => (r.userId ? 2 : 0) + (r.tool === "*" ? 0 : 1);
  const policy = rows.sort((a, b) => rank(b) - rank(a))[0];
  if (!policy) return tool.risk === "read" || tool.risk === "write" ? "auto" : "approve";
  if (policy.level === "auto" && policy.dailyCap != null) {
    const [used] = await db
      .select({ n: count() })
      .from(sysAudit)
      .where(
        and(
          eq(sysAudit.actorId, principal.id), eq(sysAudit.tool, tool.name), eq(sysAudit.status, "ok"),
          isNull(sysAudit.approvedBy), gte(sysAudit.at, new Date(Date.now() - 24 * 3600_000)),
        ),
      );
    if (used.n >= policy.dailyCap) return "approve";
  }
  return policy.level;
}

export async function invoke<O = unknown>(
  db: Db, principal: Principal, name: string, rawInput: unknown, opts: InvokeOptions = {},
): Promise<InvokeResult<O>> {
  const tool = registry.get(name);
  if (!tool) return { status: "error", code: "unknown_tool", message: `No tool named ${name}` };

  const parsed = tool.input.safeParse(rawInput);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message }));
    await audit(db, principal, name, "invalid", { input: redacted(rawInput, tool.redact), error: JSON.stringify(issues), ...opts });
    return { status: "invalid", issues };
  }
  const input = parsed.data;
  const logged = redacted(input, tool.redact);

  if (!principal.permissions.has(tool.permission)) {
    await audit(db, principal, name, "denied", { input: logged, error: `missing ${tool.permission}`, ...opts });
    return { status: "denied", reason: `${principal.name} lacks ${tool.permission}` };
  }

  // The dial applies to agents only, and not to a call a human has just approved.
  if (principal.kind === "agent" && !opts.approvedBy) {
    const level = await autonomyFor(db, principal, tool);
    if (level !== "auto") {
      const approval = await db.transaction(async (tx) => {
        const number = await nextNumber(tx, "APR");
        const [row] = await tx
          .insert(task)
          .values({
            number, taskType: "approval", state: "awaiting_approval", createdBy: principal.id,
            shortDescription: `${principal.name} wants to run ${name}`,
            payload: { tool: name, input, requestedBy: principal.id, level, runId: opts.runId ?? null },
          })
          .returning({ id: task.id, number: task.number });
        await audit(tx, principal, name, "held", { input: logged, result: { approval: row.number }, ...opts });
        await emit(tx, "approval.requested", { taskId: row.id, tool: name }, principal.id);
        return row;
      });
      return { status: "pending_approval", approval };
    }
  }

  try {
    const output = await db.transaction(async (tx) => {
      const ctx: ToolContext = {
        db: tx, principal,
        emit: (event, payload) => emit(tx, event, payload, principal.id),
        enqueue: (message) => enqueue(tx, { ...message, createdBy: principal.id }),
      };
      const out = await tool.handler(ctx, input);
      await audit(tx, principal, name, "ok", { input: logged, result: redacted(out, tool.redact), ...opts });
      return out;
    });
    return { status: "ok", output: output as O };
  } catch (error) {
    const code = error instanceof ToolError ? error.code : "internal";
    const message = error instanceof Error ? error.message : String(error);
    await audit(db, principal, name, "error", { input: logged, error: message, ...opts });
    if (!(error instanceof ToolError)) console.error(`[tool:${name}]`, error);
    return { status: "error", code, message: error instanceof ToolError ? message : "The tool failed" };
  }
}

type ApprovalPayload = { tool: string; input: unknown; requestedBy: string; runId?: string | null };

/**
 * A person decides a held agent call. Approving runs it as the agent, with the
 * approver recorded on the audit row. The approver needs approval.decide and
 * the tool's own permission: nobody can approve what they could not do themselves.
 */
/** The parts of a held request a person may reword before approving it: the words of a message, nothing else. */
const EDITABLE: Record<string, string[]> = { "message.send": ["subject", "body"], "campaign.send": ["subject", "body"] };

export async function decideApproval(
  db: Db, approver: Principal, taskId: string, decision: "approve" | "reject", edits: Record<string, string | undefined> = {},
): Promise<InvokeResult> {
  if (approver.kind !== "human") return { status: "denied", reason: "Only a person can decide an approval" };
  if (!approver.permissions.has("approval.decide")) return { status: "denied", reason: `${approver.name} lacks approval.decide` };

  // Claim the task first, so two approvers cannot both run it.
  const [claimed] = await db
    .update(task)
    .set({ state: "in_progress", updatedBy: approver.id, updatedAt: new Date() })
    .where(and(eq(task.id, taskId), eq(task.taskType, "approval"), eq(task.state, "awaiting_approval")))
    .returning();
  if (!claimed) return { status: "error", code: "not_pending", message: "That approval is not waiting for a decision" };
  const payload = claimed.payload as ApprovalPayload;
  const close = (state: "done" | "rejected" | "awaiting_approval") =>
    db
      .update(task)
      .set(state === "awaiting_approval" ? { state } : { state, closedAt: new Date(), closedBy: approver.id })
      .where(eq(task.id, taskId));

  if (decision === "reject") {
    await close("rejected");
    await emit(db, "approval.rejected", { taskId, tool: payload.tool }, approver.id);
    return { status: "ok", output: { rejected: true } };
  }

  const tool = registry.get(payload.tool);
  const agent = await loadPrincipal(db, payload.requestedBy);
  if (!tool || !agent || !approver.permissions.has(tool.permission)) {
    await close("awaiting_approval");
    return { status: "denied", reason: tool && agent ? `${approver.name} lacks ${tool.permission}` : "The request is no longer valid" };
  }
  let input = payload.input;
  const changed = (EDITABLE[payload.tool] ?? []).filter((k) => edits[k] !== undefined && edits[k] !== (payload.input as Record<string, unknown>)[k]);
  if (changed.length) {
    input = { ...(payload.input as Record<string, unknown>), ...Object.fromEntries(changed.map((k) => [k, edits[k]])) };
    // Keep the agent's original beside the person's wording, so the difference can always be seen.
    await db.update(task).set({ payload: { ...claimed.payload, input, original: payload.input, editedBy: approver.id, edited: changed } }).where(eq(task.id, taskId));
  }
  const result = await invoke(db, agent, payload.tool, input, { approvedBy: approver.id, runId: payload.runId ?? undefined });
  await close(result.status === "ok" ? "done" : "awaiting_approval");
  return result;
}
