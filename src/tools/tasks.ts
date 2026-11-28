import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { sysJournal, sysUser, task } from "@/db/schema";
import { nextNumber } from "@/platform/numbers";
import { defineTool, ToolError } from "@/platform/tools";

export const taskCreate = defineTool({
  name: "task.create",
  description: "Create a to-do for a person or an agent, optionally tied to an event.",
  permission: "task.write",
  risk: "write",
  input: z.object({
    shortDescription: z.string().min(2).max(200),
    description: z.string().max(4000).optional(),
    eventId: z.uuid().optional(),
    assignedTo: z.uuid().optional(),
    dueAt: z.iso.datetime({ offset: true }).optional(),
    priority: z.number().int().min(1).max(5).default(3),
    leadId: z.uuid().optional().describe("Ties the to-do to a lead, as a follow-up"),
  }),
  async handler(ctx, { dueAt, leadId, ...input }) {
    const [row] = await ctx.db
      .insert(task)
      .values({
        ...input, dueAt: dueAt ? new Date(dueAt) : null, number: await nextNumber(ctx.db, "TASK"), payload: leadId ? { leadId } : {},
        createdBy: ctx.principal.id, updatedBy: ctx.principal.id,
      })
      .returning({ id: task.id, number: task.number });
    await ctx.emit("task.created", { taskId: row.id, eventId: input.eventId ?? null });
    return row;
  },
});

export const taskSetState = defineTool({
  name: "task.set_state",
  description: "Mark a to-do open, in progress, done or cancelled.",
  permission: "task.write",
  risk: "write",
  input: z.object({ taskId: z.uuid(), state: z.enum(["open", "in_progress", "done", "cancelled"]) }),
  async handler(ctx, { taskId, state }) {
    const closed = state === "done" || state === "cancelled";
    const [row] = await ctx.db
      .update(task)
      .set({ state, closedAt: closed ? new Date() : null, closedBy: closed ? ctx.principal.id : null, updatedBy: ctx.principal.id, updatedAt: new Date() })
      // Approvals and agent runs have their own lifecycle and cannot be closed this way.
      .where(and(eq(task.id, taskId), eq(task.taskType, "task")))
      .returning({ id: task.id, state: task.state });
    if (!row) throw new ToolError("not_found", "No such to-do");
    return row;
  },
});

export const NOTE_TABLES = ["event", "lead", "contact", "registration", "task"] as const;

export const noteAdd = defineTool({
  name: "note.add",
  description: "Add a note to the activity stream of an event, lead, contact, registration or task. Use it for briefs, summaries and reasoning.",
  permission: "note.write",
  risk: "write",
  input: z.object({ table: z.enum(NOTE_TABLES), recordId: z.uuid(), body: z.string().min(1).max(8000) }),
  async handler(ctx, { table, recordId, body }) {
    const [row] = await ctx.db
      .insert(sysJournal)
      .values({ tableName: table, recordId, authorId: ctx.principal.id, body, kind: "work_note" })
      .returning({ id: sysJournal.id });
    return row;
  },
});

/** Agents that take on queued work. Concierge is not here: it answers guests live. */
export const AGENT_NAMES = ["Builder", "Lead Intelligence", "Analyst", "Outreach"] as const;

export const agentRun = defineTool({
  name: "agent.run",
  description: "Ask an agent to work towards a goal. The run is queued and carried out in the background.",
  permission: "agent.run",
  risk: "write",
  input: z.object({ agent: z.enum(AGENT_NAMES), goal: z.string().min(5).max(4000), eventId: z.uuid().optional() }),
  async handler(ctx, { agent, goal, eventId }) {
    const { agentsEnabled } = await import("@/agents/model");
    if (!agentsEnabled()) throw new ToolError("agents_off", "Agents are switched off. Add ANTHROPIC_API_KEY to the .env file and restart.");
    const [who] = await ctx.db.select({ id: sysUser.id }).from(sysUser).where(and(eq(sysUser.name, agent), eq(sysUser.kind, "agent"), eq(sysUser.active, true)));
    if (!who) throw new ToolError("not_found", `There is no active agent called ${agent}`);
    const [row] = await ctx.db
      .insert(task)
      .values({
        number: await nextNumber(ctx.db, "RUN"), taskType: "agent_run", state: "open", assignedTo: who.id, eventId: eventId ?? null,
        shortDescription: `${agent}: ${goal.slice(0, 120)}`, payload: { agent, goal, requestedBy: ctx.principal.id },
        createdBy: ctx.principal.id, updatedBy: ctx.principal.id,
      })
      .returning({ id: task.id, number: task.number });
    await ctx.emit("agent.run_requested", { runId: row.id, agent, eventId: eventId ?? null });
    return row;
  },
});
