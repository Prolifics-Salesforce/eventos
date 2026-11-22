/**
 * Phase 0 exit gate: the same tool call by a person and by an agent is
 * permissioned and audited. Runs against a real (embedded) Postgres.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { openDb, type Db } from "@/db/client";
import { sysAudit, sysEvent, sysOutbox, sysPolicy, task } from "@/db/schema";
import { drainEvents, subscribe } from "@/platform/events";
import { drainOutbox, setDriver } from "@/platform/outbox";
import { loadPrincipal, type Principal } from "@/platform/principal";
import { createUser, seedRoles } from "@/platform/seed";
import { decideApproval, invoke, toolCatalog } from "@/platform/tools";
import "@/tools";

let db: Db;
let organiser: Principal, desk: Principal, builder: Principal, leadAgent: Principal;
const principal = async (id: string) => (await loadPrincipal(db, id))!;
const ok = <T>(r: { status: string; output?: unknown }) => {
  expect(r.status).toBe("ok");
  return r.output as T;
};

beforeAll(async () => {
  db = await openDb();
  await seedRoles(db);
  organiser = await principal(await createUser(db, { name: "Asha", kind: "human", email: "asha@example.test", roles: ["organiser"] }));
  desk = await principal(await createUser(db, { name: "Dev", kind: "human", roles: ["desk"] }));
  builder = await principal(await createUser(db, { name: "Builder", kind: "agent", roles: ["agent_builder"] }));
  leadAgent = await principal(await createUser(db, { name: "Lead Intelligence", kind: "agent", roles: ["agent_lead"] }));
});

describe("one door for people and agents", () => {
  it("lets a person and an agent run the same tool, and audits both", async () => {
    const a = ok<{ number: string }>(await invoke(db, organiser, "event.create", { name: "Partner Summit", kind: "conference" }));
    const b = ok<{ number: string }>(await invoke(db, builder, "event.create", { name: "Booth at AI Expo", kind: "booth" }));
    expect([a.number, b.number]).toEqual(["EVT0000001", "EVT0000002"]);

    const rows = await db.select().from(sysAudit).where(and(eq(sysAudit.tool, "event.create"), eq(sysAudit.status, "ok")));
    expect(rows.map((r) => r.actorKind).sort()).toEqual(["agent", "human"]);
  });

  it("denies a call the principal has no permission for, and records the denial", async () => {
    const r = await invoke(db, desk, "event.create", { name: "Nope", kind: "booth" });
    expect(r.status).toBe("denied");
    const [row] = await db.select().from(sysAudit).where(and(eq(sysAudit.actorId, desk.id), eq(sysAudit.status, "denied")));
    expect(row.error).toContain("event.write");
  });

  it("rejects bad input before anything is written", async () => {
    const r = await invoke(db, organiser, "event.create", { name: "x", kind: "party" });
    expect(r.status).toBe("invalid");
  });

  it("rolls back the whole call when a handler refuses", async () => {
    const before = (await db.select().from(sysEvent)).length;
    const booth = ok<{ id: string }>(await invoke(db, organiser, "event.create", { name: "Field Day", kind: "field" }));
    const r = await invoke(db, organiser, "session.create", { eventId: booth.id, title: "Keynote" });
    expect(r).toMatchObject({ status: "error", code: "wrong_kind" });
    expect((await db.select().from(sysEvent)).length).toBe(before + 1); // only event.created
  });
});

describe("the autonomy dial", () => {
  let eventId: string;

  it("holds an agent's external action for approval; a person's goes straight through", async () => {
    eventId = ok<{ id: string }>(await invoke(db, builder, "event.create", { name: "Launch Night", kind: "field" })).id;
    const held = await invoke(db, builder, "event.set_status", { eventId, status: "live" });
    expect(held.status).toBe("pending_approval");
    expect(ok<{ status: string }>(await invoke(db, builder, "event.get", { eventId })).status).toBe("draft");

    if (held.status !== "pending_approval") throw new Error("unreachable");
    // The desk cannot approve; the organiser can, and the call then runs as the agent.
    expect((await decideApproval(db, desk, held.approval.id, "approve")).status).toBe("denied");
    ok(await decideApproval(db, organiser, held.approval.id, "approve"));
    expect(ok<{ status: string }>(await invoke(db, organiser, "event.get", { eventId })).status).toBe("live");

    const [row] = await db.select().from(sysAudit).where(and(eq(sysAudit.tool, "event.set_status"), eq(sysAudit.status, "ok")));
    expect(row).toMatchObject({ actorId: builder.id, approvedBy: organiser.id });
    const [approval] = await db.select().from(task).where(eq(task.id, held.approval.id));
    expect(approval).toMatchObject({ taskType: "approval", state: "done", closedBy: organiser.id });
    // Deciding twice does nothing.
    expect((await decideApproval(db, organiser, held.approval.id, "approve")).status).toBe("error");
  });

  it("lets a policy grant autonomy with a daily cap, then holds beyond it", async () => {
    await db.insert(sysPolicy).values({ userId: builder.id, tool: "event.set_status", level: "auto", dailyCap: 1 });
    expect((await invoke(db, builder, "event.set_status", { eventId, status: "closed" })).status).toBe("ok");
    expect((await invoke(db, builder, "event.set_status", { eventId, status: "archived" })).status).toBe("pending_approval");
  });

  it("drops a rejected request without running it", async () => {
    const held = await invoke(db, builder, "event.set_status", { eventId, status: "draft" });
    if (held.status !== "pending_approval") throw new Error("expected a hold");
    ok(await decideApproval(db, organiser, held.approval.id, "reject"));
    expect(ok<{ status: string }>(await invoke(db, organiser, "event.get", { eventId })).status).toBe("closed");
  });
});

describe("events, consent and the outbox", () => {
  it("delivers domain events to subscribers once, and retries a failing subscriber", async () => {
    await drainEvents(db, 500); // clear what earlier tests emitted
    const seen: string[] = [];
    let fail = true;
    const off = subscribe("registration.created", async (_db, e) => {
      if (fail) { fail = false; throw new Error("boom"); }
      seen.push(String(e.payload.registrationId));
    });
    const ev = ok<{ id: string }>(await invoke(db, organiser, "event.create", { name: "Roadshow", kind: "field" }));
    const person = ok<{ id: string }>(await invoke(db, organiser, "contact.upsert", { email: "Sam@Acme.test", firstName: "Sam" }));
    const reg = ok<{ id: string; created: boolean }>(await invoke(db, organiser, "registration.create", { eventId: ev.id, contactId: person.id }));
    const again = ok<{ id: string; created: boolean }>(await invoke(db, organiser, "registration.create", { eventId: ev.id, contactId: person.id }));
    expect([reg.created, again.created, again.id === reg.id]).toEqual([true, false, true]);

    expect((await drainEvents(db)).failed).toBe(1);
    expect((await drainEvents(db)).delivered).toBe(1);
    expect(seen).toEqual([reg.id]);
    expect((await drainEvents(db)).delivered).toBe(0);
    off();
  });

  it("refuses WhatsApp without opt-in, then queues, sends once and retries failures", async () => {
    const person = ok<{ id: string }>(await invoke(db, organiser, "contact.upsert", { email: "sam@acme.test", firstName: "Sam", phone: "+919876543210" }));
    const msg = { contactId: person.id, channel: "whatsapp", body: "See you at stand B12", dedupeKey: "wa-1" };
    expect(await invoke(db, organiser, "message.send", msg)).toMatchObject({ status: "error", code: "no_consent" });

    ok(await invoke(db, organiser, "contact.upsert", { email: "sam@acme.test", firstName: "Sam", whatsappOptIn: true }));
    expect(ok<{ queued: boolean }>(await invoke(db, organiser, "message.send", msg)).queued).toBe(true);
    expect(ok<{ queued: boolean }>(await invoke(db, organiser, "message.send", msg)).queued).toBe(false); // deduped

    // An agent's message waits for a person.
    expect((await invoke(db, leadAgent, "message.send", { ...msg, dedupeKey: "wa-2" })).status).toBe("pending_approval");

    const sent: string[] = [];
    let down = true;
    setDriver("whatsapp", async (m) => {
      if (down) throw new Error("provider down");
      sent.push(m.recipient);
    });
    expect(await drainOutbox(db)).toEqual({ sent: 0, failed: 1 });
    down = false;
    expect(await drainOutbox(db)).toEqual({ sent: 0, failed: 0 }); // backing off
    await db.update(sysOutbox).set({ nextAttemptAt: new Date(0) });
    expect(await drainOutbox(db)).toEqual({ sent: 1, failed: 0 });
    expect(sent).toEqual(["+919876543210"]);
    expect(await drainOutbox(db)).toEqual({ sent: 0, failed: 0 });
  });

  it("publishes every tool with a JSON Schema a model can be given", () => {
    const catalog = toolCatalog();
    expect(catalog.length).toBeGreaterThanOrEqual(10);
    for (const t of catalog) expect(t.inputSchema).toMatchObject({ type: "object" });
  });
});
