/** Phases 2 and 3: the agent runtime, driven by a scripted stand-in for the model. */
import { beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { openDb, type Db } from "@/db/client";
import { event, lead, sysAudit, sysJournal, sysOutbox, sysUser, task } from "@/db/schema";
import { setModel, type Block, type ModelClient } from "@/agents/model";
import { executeRun, runNextAgentRun } from "@/agents/runtime";
import { drainEvents } from "@/platform/events";
import { loadPrincipal, type Principal } from "@/platform/principal";
import { createUser, ensurePlatform } from "@/platform/seed";
import { decideApproval, invoke } from "@/platform/tools";
import "@/rules";

let db: Db;
let admin: Principal;
let leadAgentId: string;
let eventId: string, leadId: string, contactId: string;

/** A model that replies with a fixed sequence of turns and records what it was shown. */
function scripted(turns: Block[][]) {
  const seen: Parameters<ModelClient>[0][] = [];
  const model: ModelClient = async (request) => {
    seen.push(structuredClone(request));
    const content = turns.shift() ?? [{ type: "text", text: "Nothing more to do." }];
    return { content, stopReason: content.some((b) => b.type === "tool_use") ? "tool_use" : "end_turn" };
  };
  return { model, seen };
}
const use = (id: string, name: string, input: unknown): Block => ({ type: "tool_use", id, name, input });
const out = <T>(r: { status: string; output?: unknown }) => {
  expect(r.status).toBe("ok");
  return r.output as T;
};

beforeAll(async () => {
  db = await openDb();
  await ensurePlatform(db);
  admin = (await loadPrincipal(db, await createUser(db, { name: "Asha", kind: "human", email: "asha@example.test", roles: ["admin"] })))!;
  leadAgentId = (await db.select().from(sysUser).where(and(eq(sysUser.name, "Lead Intelligence"), eq(sysUser.kind, "agent"))))[0].id;
  setModel(null);
  eventId = out<{ id: string }>(await invoke(db, admin, "event.create", { name: "AI Expo Booth", kind: "booth", brief: "Meet 40 data leaders" })).id;
  contactId = out<{ id: string }>(await invoke(db, admin, "contact.upsert", { email: "ravi@corp.test", firstName: "Ravi", title: "VP Data" })).id;
  leadId = out<{ id: string }>(await invoke(db, admin, "lead.capture", { eventId, contactId, notes: "Wants a demo of the lakehouse migration next week" })).id;
});

describe("agent runs", () => {
  it("cannot be started while agents are switched off", async () => {
    expect(await invoke(db, admin, "agent.run", { agent: "Analyst", goal: "How is the event going?", eventId })).toMatchObject({ status: "error", code: "agents_off" });
  });

  it("scores a lead, has its email held for approval, and leaves a readable trail", async () => {
    const { model, seen } = scripted([
      [{ type: "text", text: "Reading the lead." }, use("t1", "lead-get", { leadId })],
      [use("t2", "lead-score", { leadId, score: 82, reason: "Senior title and asked for a demo next week" }),
       use("t3", "message-send", { contactId, channel: "email", subject: "Lakehouse demo", body: "Hi Ravi, good to meet you at the booth." }),
       use("t4", "event-create", { name: "Rogue event", kind: "booth" })],
      [{ type: "text", text: "Scored the lead hot and queued a follow-up for approval." }],
    ]);
    setModel(model);
    const run = out<{ id: string; number: string }>(await invoke(db, admin, "agent.run", { agent: "Lead Intelligence", goal: `Score lead ${leadId} and draft a follow-up.`, eventId }));
    expect(run.number).toBe("RUN0000001");
    expect(await runNextAgentRun(db)).toBe(true);
    expect(await runNextAgentRun(db)).toBe(false);

    // The model was offered only this agent's tools, under names it can use.
    expect(seen[0].tools.map((t) => t.name).sort()).toEqual(["lead-get", "lead-score", "message-send", "note-add", "task-create"]);
    // It saw the real lead, and was told the email is waiting for a person.
    const fed = JSON.stringify(seen[1].messages) + JSON.stringify(seen[2].messages);
    expect(fed).toContain("lakehouse migration");
    expect(fed).toContain("Held for a person to approve");
    expect(fed).toContain("not available to you");

    const [scored] = await db.select().from(lead).where(eq(lead.id, leadId));
    expect([scored.score, scored.band]).toEqual([82, "hot"]);
    expect(await db.select().from(sysOutbox)).toHaveLength(0);
    expect((await db.select().from(event)).map((e) => e.name)).toEqual(["AI Expo Booth"]);

    const [finished] = await db.select().from(task).where(eq(task.id, run.id));
    expect(finished.state).toBe("done");
    expect((finished.payload as { summary: string }).summary).toContain("queued a follow-up");
    const trail = (await db.select().from(sysJournal).where(and(eq(sysJournal.tableName, "task"), eq(sysJournal.recordId, run.id)))).map((j) => j.body);
    expect(trail).toEqual(expect.arrayContaining(["Reading the lead.", "lead.get → done", "lead.score → done", expect.stringContaining("message.send → held for approval as APR")]));

    // Every call the agent made is in the ledger, tied to this run.
    const calls = await db.select().from(sysAudit).where(eq(sysAudit.runId, run.id));
    expect(calls.map((c) => `${c.tool}:${c.status}`).sort()).toEqual(["lead.get:ok", "lead.score:ok", "message.send:held"]);
  });

  it("sends the held email once a person approves it", async () => {
    const [approval] = await db.select().from(task).where(and(eq(task.taskType, "approval"), eq(task.state, "awaiting_approval")));
    expect((await decideApproval(db, admin, approval.id, "approve")).status).toBe("ok");
    const [queued] = await db.select().from(sysOutbox);
    expect([queued.recipient, queued.subject]).toEqual(["ravi@corp.test", "Lakehouse demo"]);
  });

  it("goes straight through once the dial is turned to auto", async () => {
    out(await invoke(db, admin, "policy.set", { agentId: leadAgentId, tool: "message.send", level: "auto", dailyCap: 50 }));
    const agent = (await loadPrincipal(db, leadAgentId))!;
    expect((await invoke(db, agent, "message.send", { contactId, channel: "email", subject: "Agenda", body: "Here is the agenda." })).status).toBe("ok");
  });

  it("starts a Lead Intelligence run automatically when a lead is captured", async () => {
    await drainEvents(db, 200);
    const before = (await db.select().from(task).where(eq(task.taskType, "agent_run"))).length;
    out(await invoke(db, admin, "lead.capture", { eventId, contactId, notes: "Asked about pricing" }));
    await drainEvents(db);
    const runs = await db.select().from(task).where(eq(task.taskType, "agent_run"));
    expect(runs.length).toBe(before + 1);
    expect(runs.at(-1)!.assignedTo).toBe(leadAgentId);
  });

  it("marks a run failed, not stuck, when the model errors", async () => {
    const [queued] = await db.select().from(task).where(and(eq(task.taskType, "agent_run"), eq(task.state, "open")));
    expect(await executeRun(db, queued.id, async () => { throw new Error("model unavailable"); })).toBe("failed");
    const [after] = await db.select().from(task).where(eq(task.id, queued.id));
    expect(after.state).toBe("failed");
  });
});

describe("team", () => {
  it("adds a person without the password ever reaching the ledger", async () => {
    out(await invoke(db, admin, "user.create", { name: "Dev Patel", email: "dev@example.test", role: "desk", password: "a-long-enough-secret" }));
    const [row] = await db.select().from(sysAudit).where(eq(sysAudit.tool, "user.create"));
    expect(JSON.stringify(row.input)).not.toContain("a-long-enough-secret");
    expect((row.input as { password: string }).password).toBe("[redacted]");
  });
});
