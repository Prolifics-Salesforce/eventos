/** Phase 1, the rest: emails that send themselves, sending later, HTML email, forgotten passwords, guest corrections, scanned passes. */
import { beforeAll, describe, expect, it } from "vitest";
import { and, eq, like } from "drizzle-orm";
import { openDb, type Db } from "@/db/client";
import { contact, registration, sysAudit, sysOutbox, sysProperty, sysSession } from "@/db/schema";
import { setPassword, signIn } from "@/platform/auth";
import { drainEvents } from "@/platform/events";
import { emailHtml } from "@/platform/mail";
import { drainOutbox, setDriver, type OutboxMessage } from "@/platform/outbox";
import { DEFAULT_ROLES } from "@/platform/permissions";
import { loadPrincipal, type Principal } from "@/platform/principal";
import { runSchedules } from "@/platform/schedules";
import { createUser, ensurePlatform, servicePrincipal } from "@/platform/seed";
import { invoke } from "@/platform/tools";
import "@/rules";

let db: Db;
let admin: Principal;
let organiser: Principal;
let desk: Principal;
let site: Principal;
const sent: OutboxMessage[] = [];

const HOUR = 3600_000;
const ok = async <T>(who: Principal, tool: string, input: unknown): Promise<T> => {
  const result = await invoke<T>(db, who, tool, input);
  if (result.status !== "ok") throw new Error(`${tool}: ${JSON.stringify(result)}`);
  return result.output;
};
const person = async (name: string, role: string) => (await loadPrincipal(db, await createUser(db, { name, kind: "human", email: `${name.toLowerCase()}@team.test`, roles: [role] })))!;
const at = (ms: number) => new Date(Date.now() + ms).toISOString();
/** A live event starting `startsIn` ms from now, with one guest per name. */
const liveEvent = async (name: string, startsIn: number, guests: string[] = [], extra: Record<string, unknown> = {}) => {
  const e = await ok<{ id: string; slug: string }>(organiser, "event.create", { name, kind: "field", startsAt: at(startsIn), ...extra });
  await ok(organiser, "event.set_status", { eventId: e.id, status: "live" });
  for (const g of guests) await ok(site, "registration.register_guest", { eventSlug: e.slug, firstName: g, email: `${g.toLowerCase()}@${e.slug}.test` });
  await drainEvents(db);
  return e;
};
const subjectsFor = async (eventId: string) => (await db.select().from(sysOutbox).where(eq(sysOutbox.eventId, eventId))).map((m) => m.subject ?? "");
const reg = async (eventId: string, email: string) => {
  const [c] = await db.select().from(contact).where(eq(contact.email, email));
  const [r] = await db.select().from(registration).where(and(eq(registration.eventId, eventId), eq(registration.contactId, c.id)));
  return r;
};

beforeAll(async () => {
  db = await openDb();
  await ensurePlatform(db);
  admin = await person("Ada", "admin");
  organiser = await person("Omar", "organiser");
  desk = await person("Dana", "desk");
  site = await servicePrincipal(db, "Public site");
  setDriver("email", async (m) => { sent.push(m); });
});

describe("reminders", () => {
  it("sends one a day before and one an hour before, each once", async () => {
    const e = await liveEvent("Two Reminders", 20 * HOUR, ["Rita"]);
    await runSchedules(db);
    await runSchedules(db);
    expect((await subjectsFor(e.id)).filter((s) => s.startsWith("Tomorrow:"))).toHaveLength(1);
    expect((await subjectsFor(e.id)).filter((s) => s.startsWith("Starting soon:"))).toHaveLength(0);

    await runSchedules(db, new Date(Date.now() + 19.5 * HOUR));
    await runSchedules(db, new Date(Date.now() + 19.6 * HOUR));
    const subjects = await subjectsFor(e.id);
    expect(subjects.filter((s) => s.startsWith("Starting soon:"))).toHaveLength(1);
    expect(subjects.filter((s) => s.startsWith("Tomorrow:"))).toHaveLength(1);
  });

  it("sends only the hour-before one when an event goes live with under an hour to go", async () => {
    const e = await liveEvent("Last Minute", 0.5 * HOUR, ["Lena"]);
    await runSchedules(db);
    const subjects = await subjectsFor(e.id);
    expect(subjects.filter((s) => s.startsWith("Starting soon:"))).toHaveLength(1);
    expect(subjects.filter((s) => s.startsWith("Tomorrow:"))).toHaveLength(0);
  });

  it("sends none when the event has them switched off", async () => {
    const e = await liveEvent("Quiet Event", 0.5 * HOUR, ["Quinn"]);
    await ok(organiser, "event.update", { eventId: e.id, reminders: false });
    await runSchedules(db);
    expect((await subjectsFor(e.id)).some((s) => /^(Tomorrow|Starting soon):/.test(s))).toBe(false);
  });
});

describe("the feedback email", () => {
  it("goes once, an hour after the end, to those who came and nobody else", async () => {
    const e = await liveEvent("Feedback Please", -5 * HOUR, ["Came", "Stayed-home"], { endsAt: at(-3 * HOUR) });
    await ok(organiser, "event.update", { eventId: e.id, feedbackEmail: true });
    await ok(desk, "registration.check_in", { registrationId: (await reg(e.id, `came@${e.slug}.test`)).id });
    await runSchedules(db);
    await runSchedules(db);
    const asks = (await db.select().from(sysOutbox).where(eq(sysOutbox.eventId, e.id))).filter((m) => m.subject?.startsWith("How was"));
    expect(asks.map((m) => m.recipient)).toEqual([`came@${e.slug}.test`]);
    expect(asks[0].body).toContain(`/e/${e.slug}/pass/`);
  });

  it("waits for the hour, is off unless asked for, and is not sent for an event long over", async () => {
    const justEnded = await liveEvent("Just Ended", -2 * HOUR, ["A"], { endsAt: at(-0.5 * HOUR) });
    const notAsked = await liveEvent("Not Asked", -5 * HOUR, ["B"], { endsAt: at(-3 * HOUR) });
    const longAgo = await liveEvent("Long Ago", -30 * 24 * HOUR, ["C"], { endsAt: at(-29 * 24 * HOUR) });
    for (const [e, on] of [[justEnded, true], [notAsked, false], [longAgo, true]] as const) {
      await ok(organiser, "event.update", { eventId: e.id, feedbackEmail: on });
      const [c] = await db.select().from(contact).where(like(contact.email, `%@${e.slug}.test`));
      await ok(desk, "registration.check_in", { registrationId: (await reg(e.id, c.email)).id });
    }
    await runSchedules(db);
    for (const e of [justEnded, notAsked, longAgo]) expect((await subjectsFor(e.id)).some((s) => s.startsWith("How was"))).toBe(false);
    // An hour on, the one that had just ended gets its email.
    await runSchedules(db, new Date(Date.now() + HOUR));
    expect((await subjectsFor(justEnded.id)).some((s) => s.startsWith("How was"))).toBe(true);
  });
});

describe("the confirmation email", () => {
  it("carries the organisers' own note when there is one", async () => {
    const e = await ok<{ id: string; slug: string }>(organiser, "event.create", { name: "With Note", kind: "field", startsAt: at(72 * HOUR) });
    await ok(organiser, "event.update", { eventId: e.id, confirmationNote: "Parking is behind the hotel.\nAsk for Meera at reception." });
    await ok(organiser, "event.set_status", { eventId: e.id, status: "live" });
    await ok(site, "registration.register_guest", { eventSlug: e.slug, firstName: "Nora", email: "nora@note.test" });
    await drainEvents(db);
    const [mail] = await db.select().from(sysOutbox).where(eq(sysOutbox.recipient, "nora@note.test"));
    expect(mail.body).toContain("Parking is behind the hotel.");
    expect(mail.body).toContain("Ask for Meera at reception.");
  });
});

describe("sending later", () => {
  it("holds a message until its time, and can be stopped before then", async () => {
    const e = await liveEvent("Send Later", 72 * HOUR, ["Uno", "Dos"]);
    await drainOutbox(db, 100); // clear the confirmations
    sent.length = 0;

    const out = await ok<{ queued: number; sendAt: string | null; key: string }>(organiser, "campaign.send", { eventId: e.id, segment: "all", channel: "email", subject: "Agenda is final", body: "Hi {{first_name}}", sendAt: at(2 * HOUR), key: "agenda" });
    expect(out).toMatchObject({ queued: 2 });
    expect(out.sendAt).toBeTruthy();
    await drainOutbox(db, 100);
    expect(sent.filter((m) => m.subject === "Agenda is final")).toHaveLength(0);

    // A second message, also for later, is stopped; the first is left alone.
    await ok(organiser, "campaign.send", { eventId: e.id, segment: "all", channel: "email", subject: "Wrong one", body: "Oops", sendAt: at(3 * HOUR), key: "oops" });
    expect(await ok(organiser, "campaign.unschedule", { eventId: e.id, key: "oops" })).toEqual({ stopped: 2 });
    const waiting = (await db.select().from(sysOutbox).where(and(eq(sysOutbox.eventId, e.id), eq(sysOutbox.status, "pending")))).map((m) => m.subject);
    expect(waiting).toEqual(["Agenda is final", "Agenda is final"]);
  });

  it("sends at once when the time given has passed, refuses a time too far off, and cannot stop what has gone", async () => {
    const e = await liveEvent("Send Now", 72 * HOUR, ["Tres"]);
    await drainOutbox(db, 100);
    sent.length = 0;
    const out = await ok<{ sendAt: string | null }>(organiser, "campaign.send", { eventId: e.id, segment: "all", channel: "email", subject: "Now", body: "Hi", sendAt: at(-HOUR), key: "now" });
    expect(out.sendAt).toBeNull();
    await drainOutbox(db, 100);
    expect(sent.filter((m) => m.subject === "Now")).toHaveLength(1);
    expect(await ok(organiser, "campaign.unschedule", { eventId: e.id, key: "now" })).toEqual({ stopped: 0 });
    expect(await invoke(db, organiser, "campaign.send", { eventId: e.id, segment: "all", channel: "email", subject: "Far", body: "Hi", sendAt: at(120 * 24 * HOUR) })).toMatchObject({ status: "error", code: "too_far" });
  });
});

describe("HTML email", () => {
  const text = "Hi Priya,\n\nYour pass: https://events.example/e/summit/pass/abc?x=1&y=2\nSee you <there>.\n\n—\nTo stop receiving these emails: https://events.example/u/tok";
  const html = emailHtml(text, "Acme & Co", "#123456");

  it("says what the text says, with links that work and the way out set apart", () => {
    expect(html).toContain("Hi Priya,");
    expect(html).toContain('<a href="https://events.example/e/summit/pass/abc?x=1&amp;y=2"');
    expect(html).toContain('<a href="https://events.example/u/tok"');
    expect(html).toContain("border-top:1px solid");
    expect(html).toContain("Acme &amp; Co");
    expect(html).toContain("#123456");
  });

  it("never lets a guest's own words become markup", () => {
    expect(html).toContain("See you &lt;there&gt;.");
    expect(html).not.toContain("<there>");
    const nasty = emailHtml('Hi <script>alert(1)</script> "quoted" https://x.example/a"onmouseover="y', "Org");
    expect(nasty).not.toContain("<script>");
    expect(nasty).not.toMatch(/href="[^"]*"onmouseover/);
  });
});

describe("a forgotten password", () => {
  const link = async (email: string) => (await db.select().from(sysOutbox).where(and(eq(sysOutbox.recipient, email), eq(sysOutbox.subject, "Choose a new password")))).map((m) => m.body.match(/\/reset\/([\w-]+)/)![1]);

  it("emails a link that sets a new password once and signs the person out everywhere", async () => {
    const id = await createUser(db, { name: "Farah Khan", kind: "human", email: "farah@team.test", roles: ["sales"] });
    await setPassword(db, id, "the old password!");
    expect(await signIn(db, "farah@team.test", "the old password!")).toBeTruthy();

    expect(await ok(site, "account.request_reset", { email: " Farah@Team.test " })).toEqual({ sent: true });
    const [token] = await link("farah@team.test");
    expect((await invoke(db, site, "account.reset_password", { token, password: "short" })).status).toBe("invalid");
    expect(await ok(site, "account.reset_password", { token, password: "a brand new password" })).toEqual({ reset: true });

    expect(await db.select().from(sysSession).where(eq(sysSession.userId, id))).toHaveLength(0);
    expect(await signIn(db, "farah@team.test", "the old password!")).toBeNull();
    expect(await signIn(db, "farah@team.test", "a brand new password")).toBeTruthy();
    // The link is spent.
    expect(await invoke(db, site, "account.reset_password", { token, password: "yet another password" })).toMatchObject({ status: "error", code: "bad_link" });
  });

  it("says the same for an unknown email, an agent and a switched-off account, and emails none of them", async () => {
    const off = await createUser(db, { name: "Gone", kind: "human", email: "gone@team.test", roles: ["desk"] });
    await ok(admin, "user.set_active", { userId: off, active: false });
    const before = (await db.select().from(sysOutbox).where(eq(sysOutbox.subject, "Choose a new password"))).length;
    for (const email of ["nobody@team.test", "gone@team.test", "not an email"]) expect(await ok(site, "account.request_reset", { email })).toEqual({ sent: true });
    expect((await db.select().from(sysOutbox).where(eq(sysOutbox.subject, "Choose a new password"))).length).toBe(before);
  });

  it("keeps only the newest link alive, lets an old one expire, and keeps both secrets out of the ledger", async () => {
    const id = await createUser(db, { name: "Hari", kind: "human", email: "hari@team.test", roles: ["organiser"] });
    await ok(site, "account.request_reset", { email: "hari@team.test" });
    await ok(site, "account.request_reset", { email: "hari@team.test" });
    const [first, second] = await link("hari@team.test");
    expect(await invoke(db, site, "account.reset_password", { token: first, password: "a perfectly good one" })).toMatchObject({ status: "error", code: "bad_link" });

    // Age the live link past its hour.
    const [row] = await db.select().from(sysProperty).where(like(sysProperty.key, "reset:%"));
    await db.update(sysProperty).set({ value: JSON.stringify({ userId: id, until: Date.now() - 1000 }) }).where(eq(sysProperty.key, row.key));
    expect(await invoke(db, site, "account.reset_password", { token: second, password: "a perfectly good one" })).toMatchObject({ status: "error", code: "bad_link" });

    const ledger = JSON.stringify(await db.select().from(sysAudit).where(like(sysAudit.tool, "account.re%")));
    for (const secret of [first, second, "a perfectly good one", "hari@team.test"]) expect(ledger).not.toContain(secret);
  });

  it("is something only the public site account does", () => {
    for (const [role, permissions] of Object.entries(DEFAULT_ROLES)) {
      expect(permissions.includes("account.reset")).toBe(role === "public_site" || role === "admin");
    }
  });
});

describe("correcting a guest's details", () => {
  it("changes them once, for every event, and refuses an email someone else has", async () => {
    const e = await liveEvent("Typos", 72 * HOUR, ["Jon", "Other"]);
    const [jon] = await db.select().from(contact).where(eq(contact.email, `jon@${e.slug}.test`));
    await ok(organiser, "contact.update", { contactId: jon.id, firstName: "John", lastName: "Smith", email: " John.Smith@Typos.test ", title: "CTO" });
    const [after] = await db.select().from(contact).where(eq(contact.id, jon.id));
    expect(after).toMatchObject({ firstName: "John", lastName: "Smith", email: "john.smith@typos.test", title: "CTO" });
    expect(await invoke(db, organiser, "contact.update", { contactId: jon.id, email: `other@${e.slug}.test` })).toMatchObject({ status: "error", code: "email_taken" });
    expect((await invoke(db, organiser, "contact.update", { contactId: jon.id, phone: "12345" })).status).toBe("invalid");
    expect((await invoke(db, desk, "contact.update", { contactId: jon.id, firstName: "Nope" })).status).toBe("denied");
  });

  it("drops the WhatsApp opt-in when the phone number is removed", async () => {
    const c = await ok<{ id: string }>(organiser, "contact.upsert", { email: "wa@guest.test", firstName: "Wa", phone: "+919876500000", whatsappOptIn: true });
    await ok(organiser, "contact.update", { contactId: c.id, phone: null });
    const [after] = await db.select().from(contact).where(eq(contact.id, c.id));
    expect(after).toMatchObject({ phone: null, whatsappOptInAt: null });
  });
});

describe("a scanned pass", () => {
  it("checks the guest in by pass number, once, for the right event only", async () => {
    const e = await liveEvent("Scan Me", 2 * HOUR, ["Zed"]);
    const other = await liveEvent("Next Door", 2 * HOUR);
    const r = await reg(e.id, `zed@${e.slug}.test`);
    expect(await invoke(db, desk, "registration.check_in_by_number", { eventId: other.id, number: r.number })).toMatchObject({ status: "error", code: "wrong_event" });
    expect((await invoke(db, desk, "registration.check_in_by_number", { eventId: e.id, number: "https://evil.example" })).status).toBe("invalid");
    expect(await invoke(db, desk, "registration.check_in_by_number", { eventId: e.id, number: "REG999999" })).toMatchObject({ status: "error", code: "wrong_event" });

    const first = await ok<{ name: string; pin: string; alreadyCheckedIn: boolean }>(desk, "registration.check_in_by_number", { eventId: e.id, number: ` ${r.number.toLowerCase()} ` });
    expect(first).toMatchObject({ name: "Zed", alreadyCheckedIn: false });
    expect(await ok(desk, "registration.check_in_by_number", { eventId: e.id, number: r.number })).toMatchObject({ alreadyCheckedIn: true, pin: first.pin });
  });

  it("does not let in someone who cancelled, is waiting for approval, or is on the waitlist", async () => {
    const e = await liveEvent("Strict Door", 2 * HOUR);
    await ok(organiser, "event.update", { eventId: e.id, capacity: 1 });
    for (const g of ["Holder", "Waiter", "Leaver"]) await ok(site, "registration.register_guest", { eventSlug: e.slug, firstName: g, email: `${g.toLowerCase()}@strict.test` });
    const leaver = await reg(e.id, "leaver@strict.test");
    await ok(site, "registration.cancel", { registrationId: leaver.id });
    const scan = (email: string) => reg(e.id, email).then((r) => invoke(db, desk, "registration.check_in_by_number", { eventId: e.id, number: r.number }));
    expect(await scan("waiter@strict.test")).toMatchObject({ status: "error", code: "waitlisted" });
    expect(await scan("leaver@strict.test")).toMatchObject({ status: "error", code: "cancelled" });
    expect((await scan("holder@strict.test")).status).toBe("ok");

    const gated = await liveEvent("Approval Door", 2 * HOUR);
    await ok(organiser, "event.update", { eventId: gated.id, requireApproval: true });
    await ok(site, "registration.register_guest", { eventSlug: gated.slug, firstName: "Pending", email: "pending@strict.test" });
    const pending = await reg(gated.id, "pending@strict.test");
    expect(await invoke(db, desk, "registration.check_in_by_number", { eventId: gated.id, number: pending.number })).toMatchObject({ status: "error", code: "not_approved" });
  });
});
