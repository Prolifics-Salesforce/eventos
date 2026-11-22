/** Guest lists and RSVP, capacity and waitlists, surveys, budget and ROI, cloning, webhooks, the playbook and edited approvals. */
import { createServer } from "node:http";
import { beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { openDb, type Db } from "@/db/client";
import { contact, registration, sysAudit, sysOutbox, sysUser, task } from "@/db/schema";
import { setModel } from "@/agents/model";
import { runNextAgentRun } from "@/agents/runtime";
import { eventInsights } from "@/lib/insights";
import { drainEvents } from "@/platform/events";
import { drainOutbox, setDriver } from "@/platform/outbox";
import { loadPrincipal, type Principal } from "@/platform/principal";
import { createUser, ensurePlatform, servicePrincipal } from "@/platform/seed";
import { decideApproval, invoke } from "@/platform/tools";
import { registerWebhooks, sign, webhookDriver } from "@/platform/webhooks";
import "@/rules";

let db: Db;
let admin: Principal, site: Principal;
let eventId: string, slug: string;
const out = <T>(r: { status: string; output?: unknown }) => {
  expect(r.status).toBe("ok");
  return r.output as T;
};
const statusOf = async (email: string) => {
  const [row] = await db.select({ status: registration.status, id: registration.id }).from(registration).innerJoin(contact, eq(contact.id, registration.contactId))
    .where(and(eq(contact.email, email), eq(registration.eventId, eventId)));
  return row;
};

beforeAll(async () => {
  db = await openDb();
  await ensurePlatform(db);
  setModel(null);
  admin = (await loadPrincipal(db, await createUser(db, { name: "Asha", kind: "human", email: "asha@example.test", roles: ["admin"] })))!;
  site = await servicePrincipal(db, "Public site");
  const e = out<{ id: string; slug: string }>(await invoke(db, admin, "event.create", { name: "CXO Dinner", kind: "field", venue: "Taj", startsAt: new Date(Date.now() + 9 * 86_400_000).toISOString() }));
  [eventId, slug] = [e.id, e.slug];
  out(await invoke(db, admin, "event.update", { eventId, capacity: 2, targetRegistrations: 2, targetLeads: 2 }));
  out(await invoke(db, admin, "event.set_status", { eventId, status: "live" }));
});

describe("guest list, RSVP, capacity and waitlist", () => {
  it("imports a list as invited without emailing anyone or touching existing contacts", async () => {
    out(await invoke(db, admin, "contact.upsert", { email: "a@acme.test", firstName: "Anya", title: "CIO" }));
    const r = out<{ invited: number; alreadyOnList: number; invalid: string[] }>(await invoke(db, admin, "guest.import", {
      eventId, rows: [{ email: "A@acme.test", firstName: "Wrong name" }, { email: "b@acme.test", firstName: "Bo" }, { email: "c@acme.test", firstName: "Cy" }, { email: "d@acme.test", firstName: "Di" }, { email: "not-an-email", firstName: "X" }],
    }));
    expect(r).toEqual({ invited: 4, alreadyOnList: 0, invalid: ["not-an-email"] });
    expect(out<{ alreadyOnList: number }>(await invoke(db, admin, "guest.import", { eventId, rows: [{ email: "b@acme.test", firstName: "Bo" }] })).alreadyOnList).toBe(1);
    const [anya] = await db.select().from(contact).where(eq(contact.email, "a@acme.test"));
    expect([anya.firstName, anya.title]).toEqual(["Anya", "CIO"]);
    await drainEvents(db);
    expect(await db.select().from(sysOutbox)).toHaveLength(0);
  });

  it("sends invitations with each guest's own reply link, as one campaign", async () => {
    const sent = out<{ queued: number }>(await invoke(db, admin, "campaign.send", { eventId, segment: "invited", channel: "email", subject: "You're invited", body: "Hi {{first_name}}, reply here: {{rsvp_url}}", key: "invite" }));
    expect(sent.queued).toBe(4);
    const [mail] = await db.select().from(sysOutbox).where(eq(sysOutbox.recipient, "b@acme.test"));
    expect(mail.body).toContain(`/e/${slug}/pass/${(await statusOf("b@acme.test")).id}`);
  });

  it("gives places until the event is full, then waitlists, and promotes on a cancellation", async () => {
    const reply = async (email: string, answer: "yes" | "no") => out<{ status: string }>(await invoke(db, site, "registration.rsvp", { registrationId: (await statusOf(email)).id, answer })).status;
    expect(await reply("a@acme.test", "yes")).toBe("registered");
    expect(await reply("b@acme.test", "yes")).toBe("registered");
    expect(await reply("c@acme.test", "yes")).toBe("waitlisted");
    expect(await reply("d@acme.test", "no")).toBe("declined");
    // A walk-up from the public page also waits.
    expect(out<{ status: string }>(await invoke(db, site, "registration.register_guest", { eventSlug: slug, email: "e@acme.test", firstName: "Eve" })).status).toBe("waitlisted");

    const cancelled = out<{ promoted: string | null }>(await invoke(db, site, "registration.cancel", { registrationId: (await statusOf("b@acme.test")).id }));
    expect(cancelled.promoted).toBe((await statusOf("c@acme.test")).id); // waited longest
    expect((await statusOf("c@acme.test")).status).toBe("registered");
    expect((await statusOf("e@acme.test")).status).toBe("waitlisted");

    await drainEvents(db);
    const subjects = (await db.select().from(sysOutbox).where(eq(sysOutbox.recipient, "c@acme.test"))).map((m) => m.subject).sort();
    expect(subjects).toEqual(["You're invited", "You're on the waitlist for CXO Dinner", "You're registered for CXO Dinner"]);
  });

  it("refuses to check in someone who declined", async () => {
    expect(await invoke(db, admin, "registration.check_in", { registrationId: (await statusOf("d@acme.test")).id })).toMatchObject({ status: "error", code: "cancelled" });
  });
});

describe("what it cost and what it produced", () => {
  it("adds up the funnel, budget, pipeline and survey into one answer", async () => {
    const a = (await statusOf("a@acme.test")).id;
    out(await invoke(db, admin, "registration.check_in", { registrationId: a }));
    expect(await invoke(db, site, "survey.submit", { registrationId: (await statusOf("c@acme.test")).id, score: 9 })).toMatchObject({ status: "error", code: "not_attended" });
    out(await invoke(db, site, "survey.submit", { registrationId: a, score: 7 }));
    out(await invoke(db, site, "survey.submit", { registrationId: a, score: 10, comment: "Great room" })); // replaces the first

    const venue = out<{ id: string }>(await invoke(db, admin, "budget.set_item", { eventId, label: "Venue and dinner", planned: 200000 }));
    out(await invoke(db, admin, "budget.set_item", { eventId, label: "Gifts", planned: 40000 }));
    let i = await eventInsights(db, eventId);
    expect(i.money).toMatchObject({ planned: 240000, actual: null, costPerAttendee: 240000 });
    out(await invoke(db, admin, "budget.set_item", { eventId, itemId: venue.id, label: "Venue and dinner", planned: 200000, actual: 180000 }));

    const [anya] = await db.select().from(contact).where(eq(contact.email, "a@acme.test"));
    const lead = out<{ id: string }>(await invoke(db, admin, "lead.capture", { eventId, contactId: anya.id, notes: "Wants a proposal" }));
    out(await invoke(db, admin, "lead.set_value", { leadId: lead.id, pipelineValue: 900000 }));

    i = await eventInsights(db, eventId);
    expect(i.funnel).toMatchObject({ onList: 5, registered: 2, attended: 1, waitlisted: 1, declined: 1, cancelled: 1, awaitingReply: 0 });
    expect(i.showRate).toBe(50);
    expect(i.money).toMatchObject({ planned: 240000, actual: 180000, pipeline: 900000, costPerAttendee: 180000, costPerLead: 180000, pipelinePerUnitSpent: 5 });
    expect(i.nps).toEqual({ score: 100, responses: 1 });
    expect(i.targets).toEqual({ registrations: 2, leads: 2, capacity: 2 });
  });

  it("clones an event's setup but none of its people", async () => {
    out(await invoke(db, admin, "form.add_field", { eventId, purpose: "registration", label: "Dietary needs" }));
    const copy = out<{ id: string }>(await invoke(db, admin, "event.clone", { eventId, name: "CXO Dinner Mumbai" }));
    const got = out<{ status: string; capacity: number; stats: { funnel: { onList: number }; money: { planned: number; actual: number | null } } }>(await invoke(db, admin, "event.get", { eventId: copy.id }));
    expect([got.status, got.capacity, got.stats.funnel.onList, got.stats.money.planned, got.stats.money.actual]).toEqual(["draft", 2, 0, 240000, null]);
  });
});

describe("telling other systems", () => {
  it("delivers a signed webhook for the events asked for, and keeps the secret out of the ledger", async () => {
    const got: { headers: Record<string, string | string[] | undefined>; body: string }[] = [];
    const server = createServer((req, res) => { let body = ""; req.on("data", (c) => (body += c)); req.on("end", () => { got.push({ headers: req.headers, body }); res.end("ok"); }); });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/hook`;

    expect((await invoke(db, admin, "webhook.create", { url: "http://internal.example/hook", events: ["*"] })).status).toBe("invalid");
    const hook = out<{ secret: string }>(await invoke(db, admin, "webhook.create", { url, events: ["checkin.confirmed"] }));
    expect(JSON.stringify(await db.select().from(sysAudit).where(eq(sysAudit.tool, "webhook.create")))).not.toContain(hook.secret);

    registerWebhooks();
    setDriver("webhook", webhookDriver(async () => db));
    await drainEvents(db, 500);
    await db.delete(sysOutbox);
    out(await invoke(db, admin, "registration.check_in", { registrationId: (await statusOf("c@acme.test")).id }));
    out(await invoke(db, admin, "task.create", { eventId, shortDescription: "Not subscribed to" }));
    await drainEvents(db);
    await drainOutbox(db);
    server.close();

    expect(got).toHaveLength(1);
    const { headers, body } = got[0];
    expect(JSON.parse(body)).toMatchObject({ event: "checkin.confirmed", data: { eventId } });
    expect(headers["x-eventos-signature"]).toBe(sign(hook.secret, String(headers["x-eventos-timestamp"]), body));
  });
});

describe("staying in charge of agents", () => {
  it("gives every agent the organisation's playbook", async () => {
    out(await invoke(db, admin, "playbook.set", { text: "Always sign emails as The Northwind Events Team." }));
    let system = "";
    setModel(async (request) => { system = request.system; return { content: [{ type: "text", text: "Done." }], stopReason: "end_turn" }; });
    out(await invoke(db, admin, "agent.run", { agent: "Analyst", eventId, goal: "How is this going?" }));
    await runNextAgentRun(db);
    expect(system).toContain("Always sign emails as The Northwind Events Team.");
    setModel(null);
  });

  it("lets a person reword an agent's message before approving, and keeps both versions", async () => {
    const [row] = await db.select().from(sysUser).where(and(eq(sysUser.name, "Outreach"), eq(sysUser.kind, "agent")));
    const agent = (await loadPrincipal(db, row.id))!;
    const held = await invoke(db, agent, "campaign.send", { eventId, segment: "checked_in", channel: "email", subject: "Thanks", body: "Thx for coming {{first_name}}", key: "thanks" });
    if (held.status !== "pending_approval") throw new Error("expected a hold");
    await db.delete(sysOutbox);
    // Only the wording may change: an attempt to widen the audience is ignored.
    out(await decideApproval(db, admin, held.approval.id, "approve", { body: "Thank you for joining us, {{first_name}}.", segment: "all" }));
    const sent = await db.select().from(sysOutbox);
    expect(sent.map((m) => m.recipient).sort()).toEqual(["a@acme.test", "c@acme.test"]);
    expect(sent[0].body).toMatch(/^Thank you for joining us, (Anya|Cy)\./);
    const [approval] = await db.select().from(task).where(eq(task.id, held.approval.id));
    expect(approval.payload).toMatchObject({ edited: ["body"], editedBy: admin.id, original: { body: "Thx for coming {{first_name}}" }, input: { segment: "checked_in" } });
  });
});

describe("who a guest message reaches", () => {
  it("reminds only people holding a place, never those still invited, waiting, declined or cancelled", async () => {
    const e = out<{ id: string; slug: string }>(await invoke(db, admin, "event.create", { name: "Segment check", kind: "field" }));
    out(await invoke(db, admin, "event.update", { eventId: e.id, capacity: 1 }));
    out(await invoke(db, admin, "event.set_status", { eventId: e.id, status: "live" }));
    out(await invoke(db, admin, "guest.import", { eventId: e.id, rows: [{ email: "inv@seg.test", firstName: "Inv" }] }));
    out(await invoke(db, site, "registration.register_guest", { eventSlug: e.slug, email: "has@seg.test", firstName: "Has" }));
    out(await invoke(db, site, "registration.register_guest", { eventSlug: e.slug, email: "wait@seg.test", firstName: "Wait" }));
    await db.delete(sysOutbox);
    const reach = async (segment: string) => {
      out(await invoke(db, admin, "campaign.send", { eventId: e.id, segment, channel: "email", subject: segment, body: "x" }));
      return (await db.select().from(sysOutbox).where(eq(sysOutbox.subject, segment))).map((m) => m.recipient).sort();
    };
    expect(await reach("not_checked_in")).toEqual(["has@seg.test"]);
    expect(await reach("all")).toEqual(["has@seg.test"]);
    expect(await reach("invited")).toEqual(["inv@seg.test"]);
    expect(await reach("checked_in")).toEqual([]);
  });
});
