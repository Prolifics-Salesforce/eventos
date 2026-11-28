/** Features added for each kind of account: organiser, attendee, desk, sales and administrator. */
import { beforeAll, describe, expect, it } from "vitest";
import { and, eq, like } from "drizzle-orm";
import { openDb, type Db } from "@/db/client";
import { contact, event, eventSession, registration, sessionSpeaker, sysApiKey, sysAudit, sysOutbox, sysProperty, sysUser, task } from "@/db/schema";
import { signIn } from "@/platform/auth";
import { DEFAULT_ROLES, HUMAN_ROLES } from "@/platform/permissions";
import { loadPrincipal, principalForApiKey, type Principal } from "@/platform/principal";
import { createUser, ensurePlatform, servicePrincipal } from "@/platform/seed";
import { invoke } from "@/platform/tools";
import { roleLabel } from "@/lib/session";
import "@/rules";

let db: Db;
let admin: Principal;
let organiser: Principal;
let sales: Principal;
let desk: Principal;
let viewer: Principal;
let site: Principal;

const ok = async <T>(who: Principal, tool: string, input: unknown): Promise<T> => {
  const result = await invoke<T>(db, who, tool, input);
  if (result.status !== "ok") throw new Error(`${tool}: ${JSON.stringify(result)}`);
  return result.output;
};
const person = async (name: string, role: string) => (await loadPrincipal(db, await createUser(db, { name, kind: "human", email: `${name.toLowerCase()}@team.test`, roles: [role] })))!;
const liveEvent = async (name: string, kind = "field") => {
  const e = await ok<{ id: string; slug: string }>(organiser, "event.create", { name, kind, startsAt: "2027-09-10T10:00:00+05:30" });
  await ok(organiser, "event.set_status", { eventId: e.id, status: "live" });
  return e;
};
const reg = async (eventId: string, email: string) => {
  const [c] = await db.select().from(contact).where(eq(contact.email, email));
  const [r] = await db.select().from(registration).where(and(eq(registration.eventId, eventId), eq(registration.contactId, c.id)));
  return r;
};

beforeAll(async () => {
  process.env.SMTP_URL = "smtp://mail.test";
  db = await openDb();
  await ensurePlatform(db);
  admin = await person("Ada", "admin");
  organiser = await person("Omar", "organiser");
  sales = await person("Sam", "sales");
  desk = await person("Dana", "desk");
  viewer = await person("Vera", "viewer");
  site = await servicePrincipal(db, "Public site");
});

describe("organiser: the agenda can be changed", () => {
  it("edits a session, takes a speaker off, and removes a session without losing the speaker as a contact", async () => {
    const e = await liveEvent("Agenda Edits", "conference");
    const speaker = await ok<{ id: string }>(organiser, "contact.upsert", { email: "speaker@agenda.test", firstName: "Meera" });
    const s = await ok<{ id: string }>(organiser, "session.create", { eventId: e.id, title: "Opening", room: "Hall A", speakerContactIds: [speaker.id] });

    await ok(organiser, "session.update", { sessionId: s.id, title: "Opening keynote", room: null, startsAt: "2027-09-10T10:30:00+05:30" });
    const [after] = await db.select().from(eventSession).where(eq(eventSession.id, s.id));
    expect(after).toMatchObject({ title: "Opening keynote", room: null });
    expect(after.startsAt?.toISOString()).toBe("2027-09-10T05:00:00.000Z");

    await ok(organiser, "session.remove_speaker", { sessionId: s.id, contactId: speaker.id });
    expect(await db.select().from(sessionSpeaker).where(eq(sessionSpeaker.sessionId, s.id))).toHaveLength(0);
    expect(await invoke(db, organiser, "session.remove_speaker", { sessionId: s.id, contactId: speaker.id })).toMatchObject({ status: "error", code: "not_found" });

    await ok(organiser, "session.add_speaker", { sessionId: s.id, contactId: speaker.id });
    await ok(organiser, "session.remove", { sessionId: s.id });
    expect(await db.select().from(eventSession).where(eq(eventSession.id, s.id))).toHaveLength(0);
    expect(await db.select().from(contact).where(eq(contact.id, speaker.id))).toHaveLength(1);
    expect((await invoke(db, sales, "session.remove", { sessionId: s.id })).status).toBe("denied");
  });

  it("keeps an online link on the event, https only, and carries it to a copy", async () => {
    const e = await liveEvent("Hybrid");
    expect((await invoke(db, organiser, "event.update", { eventId: e.id, onlineUrl: "http://plain.example/room" })).status).toBe("invalid");
    await ok(organiser, "event.update", { eventId: e.id, onlineUrl: "https://meet.example/room" });
    const copy = await ok<{ id: string }>(organiser, "event.clone", { eventId: e.id, name: "Hybrid 2" });
    expect((await db.select().from(event).where(eq(event.id, copy.id)))[0].onlineUrl).toBe("https://meet.example/room");
    // The public summary says it is online without giving the link away.
    const info = await ok<Record<string, unknown>>(organiser, "event.public_info", { eventId: e.id });
    expect(info.alsoOnline).toBe(true);
    expect(JSON.stringify(info)).not.toContain("meet.example");
  });

  it("saves a message to reuse, and deletes it", async () => {
    const saved = await ok<{ id: string }>(organiser, "template.save", { name: "Agenda update", subject: "Agenda for {{event_name}}", body: "Hi {{first_name}}" });
    const [row] = await db.select().from(sysProperty).where(eq(sysProperty.key, `template:${saved.id}`));
    expect(JSON.parse(row.value)).toMatchObject({ name: "Agenda update", body: "Hi {{first_name}}" });
    await ok(organiser, "template.remove", { templateId: saved.id });
    expect(await db.select().from(sysProperty).where(like(sysProperty.key, "template:%"))).toHaveLength(0);
    expect((await invoke(db, desk, "template.save", { name: "Nope", body: "x" })).status).toBe("denied");
  });
});

describe("attendee: bringing a colleague", () => {
  it("records who brought whom, for the same event only, and never a guest bringing themselves", async () => {
    const e = await liveEvent("Referrals");
    const other = await liveEvent("Elsewhere");
    await ok(site, "registration.register_guest", { eventSlug: e.slug, firstName: "Asha", email: "asha@ref.test" });
    const asha = await reg(e.id, "asha@ref.test");

    await ok(site, "registration.register_guest", { eventSlug: e.slug, firstName: "Ben", email: "ben@ref.test", referredBy: asha.number.toLowerCase() });
    expect(await reg(e.id, "ben@ref.test")).toMatchObject({ referredBy: asha.id, source: "referral" });

    // A pass number from this event does not count on another event.
    await ok(site, "registration.register_guest", { eventSlug: other.slug, firstName: "Cy", email: "cy@ref.test", referredBy: asha.number });
    expect(await reg(other.id, "cy@ref.test")).toMatchObject({ referredBy: null, source: "web" });

    // Nor does a made-up one, nor something that is not a pass number at all.
    await ok(site, "registration.register_guest", { eventSlug: e.slug, firstName: "Di", email: "di@ref.test", referredBy: "REG99999999" });
    expect((await reg(e.id, "di@ref.test")).referredBy).toBeNull();
    expect((await invoke(db, site, "registration.register_guest", { eventSlug: e.slug, firstName: "Ed", email: "ed@ref.test", referredBy: "'; drop table" })).status).toBe("invalid");
  });
});

describe("desk: knowing when someone important arrives", () => {
  it("marks a guest as a VIP and says so at every kind of check-in", async () => {
    const e = await liveEvent("VIP Door");
    for (const who of ["vip", "plain"]) await ok(site, "registration.register_guest", { eventSlug: e.slug, firstName: who, email: `${who}@door.test` });
    const vip = await reg(e.id, "vip@door.test");
    await ok(organiser, "registration.set_vip", { registrationId: vip.id, vip: true });
    expect((await invoke(db, desk, "registration.set_vip", { registrationId: vip.id, vip: false })).status).toBe("denied");

    expect(await ok(desk, "registration.check_in_by_number", { eventId: e.id, number: vip.number })).toMatchObject({ vip: true, alreadyCheckedIn: false });
    expect(await ok(desk, "registration.check_in", { registrationId: vip.id })).toMatchObject({ vip: true, alreadyCheckedIn: true });
    expect(await ok(desk, "registration.check_in", { registrationId: (await reg(e.id, "plain@door.test")).id })).toMatchObject({ vip: false });

    await ok(organiser, "registration.set_vip", { registrationId: vip.id, vip: false });
    expect((await reg(e.id, "vip@door.test")).vip).toBe(false);
  });
});

describe("sales: following up a lead", () => {
  it("keeps a dated follow-up tied to the lead, assigned to whoever made it", async () => {
    const e = await liveEvent("Booth", "booth");
    const c = await ok<{ id: string }>(sales, "contact.upsert", { email: "prospect@lead.test", firstName: "Pat" });
    const lead = await ok<{ id: string }>(sales, "lead.capture", { eventId: e.id, contactId: c.id, notes: "Wants pricing" });
    const made = await ok<{ id: string }>(sales, "task.create", { eventId: e.id, leadId: lead.id, assignedTo: sales.id, shortDescription: "Send Pat the pricing sheet", dueAt: "2027-09-12T18:00:00+05:30" });
    const [row] = await db.select().from(task).where(eq(task.id, made.id));
    expect(row).toMatchObject({ assignedTo: sales.id, payload: { leadId: lead.id }, state: "open" });
    expect(row.dueAt?.toISOString()).toBe("2027-09-12T12:30:00.000Z");
    // And they can tick it off themselves.
    expect(await ok(sales, "task.set_state", { taskId: made.id, state: "done" })).toMatchObject({ state: "done" });
    expect((await invoke(db, desk, "task.create", { shortDescription: "Not for the desk" })).status).toBe("denied");
  });
});

describe("administrator: the team", () => {
  it("invites someone by email, who then chooses their own password", async () => {
    const out = await ok<{ id: string; link?: string }>(admin, "user.invite", { name: "Nadia Khan", email: " Nadia@Team.test ", role: "sales" });
    expect(out.link).toBeUndefined(); // a mail server is connected, so the link goes by email only
    const [mail] = await db.select().from(sysOutbox).where(eq(sysOutbox.recipient, "nadia@team.test"));
    expect(mail.subject).toBe("You have been added to the events team");
    const token = mail.body.match(/\/reset\/([\w-]+)/)![1];

    expect(await signIn(db, "nadia@team.test", "anything at all")).toBeNull(); // no password yet
    await ok(site, "account.reset_password", { token, password: "my own long password" });
    expect(await signIn(db, "nadia@team.test", "my own long password")).toBeTruthy();
    expect((await loadPrincipal(db, out.id))!.permissions.has("lead.write")).toBe(true);

    expect(await invoke(db, admin, "user.invite", { name: "Twice", email: "nadia@team.test", role: "desk" })).toMatchObject({ status: "error", code: "exists" });
    expect((await invoke(db, organiser, "user.invite", { name: "Nope", email: "nope@team.test", role: "desk" })).status).toBe("denied");
    expect(JSON.stringify(await db.select().from(sysAudit).where(eq(sysAudit.tool, "user.invite")))).not.toContain(token);
  });

  it("hands the link to the administrator when there is no mail server to send it", async () => {
    delete process.env.SMTP_URL;
    try {
      const out = await ok<{ link?: string }>(admin, "user.invite", { name: "No Mail", email: "nomail@team.test", role: "desk" });
      expect(out.link).toMatch(/\/reset\/[\w-]{20,}$/);
    } finally {
      process.env.SMTP_URL = "smtp://mail.test";
    }
  });

  it("changes the email a person signs in with, and refuses one already in use", async () => {
    const id = await createUser(db, { name: "Typo", kind: "human", email: "tpyo@team.test", roles: ["desk"] });
    await ok(admin, "user.set_email", { userId: id, email: " Typo@Team.test " });
    expect((await db.select().from(sysUser).where(eq(sysUser.id, id)))[0].email).toBe("typo@team.test");
    expect(await invoke(db, admin, "user.set_email", { userId: id, email: "ada@team.test" })).toMatchObject({ status: "error", code: "exists" });
    const [agent] = await db.select().from(sysUser).where(and(eq(sysUser.name, "Builder"), eq(sysUser.kind, "agent")));
    expect(await invoke(db, admin, "user.set_email", { userId: agent.id, email: "builder@team.test" })).toMatchObject({ status: "error", code: "not_found" });
  });

  it("creates a key that works as its owner until it is revoked, and never writes the key down", async () => {
    const { key } = await ok<{ key: string }>(admin, "apikey.create", { name: "CRM sync" });
    expect(key).toMatch(/^evk_/);
    expect((await principalForApiKey(db, key))?.id).toBe(admin.id);
    expect(JSON.stringify(await db.select().from(sysAudit).where(eq(sysAudit.tool, "apikey.create")))).not.toContain(key);
    expect(JSON.stringify(await db.select().from(sysApiKey))).not.toContain(key);

    const [row] = await db.select().from(sysApiKey).where(eq(sysApiKey.name, "CRM sync"));
    await ok(admin, "apikey.revoke", { keyId: row.id });
    expect(await principalForApiKey(db, key)).toBeNull();
    expect(await invoke(db, admin, "apikey.revoke", { keyId: row.id })).toMatchObject({ status: "error", code: "not_found" });
    expect((await invoke(db, organiser, "apikey.create", { name: "Mine" })).status).toBe("denied");
  });
});

describe("a role that only looks", () => {
  it("can be given to a person, reads events, guests and insights, and changes nothing", async () => {
    expect(HUMAN_ROLES).toContain("viewer");
    expect(roleLabel(viewer)).toBe("Viewer");
    const e = await liveEvent("Read Only");
    expect((await invoke(db, viewer, "event.get", { eventId: e.id })).status).toBe("ok");
    expect((await invoke(db, viewer, "registration.export", { eventId: e.id })).status).toBe("ok");
    for (const [tool, input] of [["event.update", { eventId: e.id, venue: "X" }], ["contact.upsert", { email: "x@y.test", firstName: "X" }], ["task.create", { shortDescription: "Nope" }], ["campaign.send", { eventId: e.id, segment: "all", channel: "email", subject: "s", body: "b" }]] as const) {
      expect((await invoke(db, viewer, tool, input)).status).toBe("denied");
    }
    for (const p of DEFAULT_ROLES.viewer) expect(p.endsWith(".read") || p === "account.self").toBe(true);
  });

  it("is labelled for what it is, like every other role", () => {
    expect([admin, organiser, sales, desk].map(roleLabel)).toEqual(["Admin", "Organiser", "Sales", "Desk"]);
  });
});
