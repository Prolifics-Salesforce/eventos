/**
 * Runs one agent towards one goal.
 *
 * A run is a row in `task` (task_type agent_run). The loop asks the model what
 * to do, carries out each tool call through `invoke()` as the agent, so the
 * permission check, the autonomy dial and the audit ledger all apply, and
 * writes every step to the run's activity stream for people to read.
 */
import { and, asc, eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { sysJournal, task } from "@/db/schema";
import { loadPrincipal, type Principal } from "@/platform/principal";
import { getTool, invoke } from "@/platform/tools";
import { getProperty } from "@/platform/properties";
import { z } from "zod";
import { AGENTS, type AgentName } from "./definitions";
import { getModel, type Block, type Message, type ModelClient, type ModelTool } from "./model";
import "@/tools";

const MAX_STEPS = 12;
const wireName = (tool: string) => tool.replace(/\./g, "-");

async function log(db: Db, runId: string, authorId: string, body: string, kind: "work_note" | "system" = "work_note") {
  await db.insert(sysJournal).values({ tableName: "task", recordId: runId, authorId, kind, body: body.slice(0, 8000) });
}

type LoopOptions = {
  db: Db; agent: Principal; model: ModelClient; system: string; messages: Message[]; toolNames: string[];
  maxSteps: number; runId?: string;
  onText?: (text: string) => Promise<void>;
  onTool?: (line: string) => Promise<void>;
};

/**
 * The agent loop itself: ask the model, carry out its tool calls through
 * `invoke()` as the agent, feed the results back, until it stops asking.
 * Returns the last thing the model said, and whether it finished in time.
 */
export async function runLoop(o: LoopOptions): Promise<{ finished: boolean; text: string; steps: number }> {
  // What the model may call: the agent's own list, narrowed to what its role permits.
  const allowed = new Map<string, string>();
  const tools: ModelTool[] = [];
  for (const name of o.toolNames) {
    const tool = getTool(name);
    if (!tool || !o.agent.permissions.has(tool.permission)) continue;
    allowed.set(wireName(name), name);
    tools.push({ name: wireName(name), description: tool.description, input_schema: z.toJSONSchema(tool.input, { io: "input" }) });
  }
  // The organisation's own rules, written by an administrator, travel with every agent.
  const playbook = (await getProperty(o.db, "playbook"))?.trim();
  const system = playbook ? `${o.system}\n\nYour organisation's playbook. Follow it wherever it applies:\n${playbook}` : o.system;
  let text = "";
  for (let step = 0; step < o.maxSteps; step++) {
    const reply = await o.model({ system, messages: o.messages, tools });
    o.messages.push({ role: "assistant", content: reply.content });
    const said = reply.content.filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
    if (said) {
      text = said;
      await o.onText?.(said);
    }
    const calls = reply.content.filter((b) => b.type === "tool_use");
    if (calls.length === 0 || reply.stopReason !== "tool_use") return { finished: true, text, steps: step + 1 };

    const results: Block[] = [];
    for (const call of calls) {
      const name = allowed.get(call.name);
      if (!name) {
        await o.onTool?.(`Tried ${call.name}, which this agent may not use.`);
        results.push({ type: "tool_result", tool_use_id: call.id, content: "That tool is not available to you.", is_error: true });
        continue;
      }
      const result = await invoke(o.db, o.agent, name, call.input, { runId: o.runId });
      const line =
        result.status === "ok" ? "done"
        : result.status === "pending_approval" ? `held for approval as ${result.approval.number}`
        : result.status === "invalid" ? `rejected: ${result.issues.map((i) => `${i.path} ${i.message}`).join("; ")}`
        : result.status === "denied" ? `denied: ${result.reason}`
        : `failed: ${result.message}`;
      await o.onTool?.(`${name} → ${line}`);
      results.push({
        type: "tool_result", tool_use_id: call.id,
        content: result.status === "pending_approval"
          ? `Held for a person to approve (${result.approval.number}). Do not retry; continue with other work.`
          : JSON.stringify(result).slice(0, 6000),
        is_error: result.status !== "ok" && result.status !== "pending_approval",
      });
    }
    o.messages.push({ role: "user", content: results });
  }
  return { finished: false, text, steps: o.maxSteps };
}

export async function executeRun(db: Db, runId: string, model: ModelClient): Promise<"done" | "failed"> {
  const [run] = await db.select().from(task).where(and(eq(task.id, runId), eq(task.taskType, "agent_run")));
  if (!run) throw new Error("No such agent run");
  const payload = run.payload as { agent: AgentName; goal: string };
  const definition = AGENTS[payload.agent];
  const agent = run.assignedTo ? await loadPrincipal(db, run.assignedTo) : null;

  const finish = async (state: "done" | "failed", extra: Record<string, unknown>) => {
    await db.update(task).set({ state, closedAt: new Date(), payload: { ...run.payload, ...extra }, updatedAt: new Date() }).where(eq(task.id, runId));
    return state;
  };
  if (!definition || !agent || agent.kind !== "agent") return finish("failed", { error: "The agent for this run is missing or inactive" });

  const messages: Message[] = [{
    role: "user",
    content: [`Goal: ${payload.goal}`, run.eventId ? `Event id: ${run.eventId}` : "", `Today is ${new Date().toISOString().slice(0, 10)}.`].filter(Boolean).join("\n"),
  }];
  await db.update(task).set({ state: "in_progress", updatedAt: new Date() }).where(eq(task.id, runId));

  try {
    const outcome = await runLoop({
      db, agent, model, system: definition.system, messages, toolNames: definition.tools, maxSteps: MAX_STEPS, runId,
      onText: (text) => log(db, runId, agent.id, text),
      onTool: (line) => log(db, runId, agent.id, line, "system"),
    });
    if (outcome.finished) return finish("done", { summary: outcome.text, steps: outcome.steps });
    return finish("failed", { summary: outcome.text, error: `Stopped after ${MAX_STEPS} steps without finishing` });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[agent:${payload.agent}]`, error);
    await log(db, runId, agent.id, `The run stopped: ${message}`, "system");
    return finish("failed", { error: message });
  }
}

/** Take the oldest queued run and carry it out. Called by the worker; one at a time. */
export async function runNextAgentRun(db: Db): Promise<boolean> {
  const model = getModel();
  if (!model) return false;
  const [next] = await db.select({ id: task.id }).from(task).where(and(eq(task.taskType, "agent_run"), eq(task.state, "open"))).orderBy(asc(task.createdAt)).limit(1);
  if (!next) return false;
  const [claimed] = await db.update(task).set({ state: "in_progress" }).where(and(eq(task.id, next.id), eq(task.state, "open"))).returning({ id: task.id });
  if (!claimed) return false;
  await executeRun(db, claimed.id, model);
  return true;
}
