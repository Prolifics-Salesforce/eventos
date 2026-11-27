/** Phase 1, the core flow: editing and cancelling events, the public page, approval, the door, and the team. */
import { beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { openDb, type Db } from "@/db/client";
import { contact, event, eventSession, registration, surveyResponse, sysOutbox, sysSession } from "@/db/schema";
import { setPassword, signIn } from "@/platform/auth";
import { drainEvents } from "@/platform/events";
import { loadPrincipal, type Principal } from "@/platform/principal";
import { createUser, ensurePlatform, servicePrincipal } from "@/platform/seed";
import { invoke } from "@/platform/tools";
import { isoToZonedLocal, zonedToIso } from "@/lib/when";
import { GET as calendar } from "@/app/e/[slug]/calendar.ics/route";
import "@/rules";

let db: Db;
let admin: Principal;
let organiser: Principal;
let desk: Principal;
let site: Principal;

const ok = async <T>(who: Principal, tool: string, input: unknown): Promise<T> => {
  const result = await invoke<T>(db, who, tool, input);
  if (result.status !== "ok") throw new Error(`${tool}: ${JSON.stringify(result)}`);
  return result.output;
};
const person = async (name: string, role: string) => (await loadPrincipal(db, await createUser(db, { name, kind: "human", email: `${name.toLowerCase()}@team.test`, roles: [role] })))!;
const liveEvent = async (name: string, extra: Record<string, unknown> = {}) => {
  const e = await ok<{ id: string; slug: string }>(organiser, "event.create", { name, kind: "field", startsAt: "2027-03-10T18:00:00+05:30", ...extra });
  await ok(organiser, "event.set_status", { eventId: e.id, status: "live" });
  return e;
};
const mailTo = (address: string) => db.select().from(sysOutbox).where(eq(sysOutbox.recipient, address));
const reg = async (eventId: string, email: string) => {
  const [c] = await db.select().from(contact).where(eq(contact.email, email));
  const [r] = await db.select().from(registration).where(and(eq(registration.eventId, eventId), eq(registration.contactId, c.id)));
  return r;
};

beforeAll(async () => {
  db = await openDb();
  // The calendar route and the tools must see the same database.
  (globalThis as unknown as { __eventosDb?: Promise<Db> }).__eventosDb = Promise.resolve(db);
  await ensurePlatform(db);
  admin = await person("Ada", "admin");
  organiser = await person("Omar", "organiser");
  desk = await person("Dana", "desk");
  site = await servicePrincipal(db, "Public site");
});

describe("editing an event", () => {
  it("changes the name, dates, description and address, and clears what is emptied", async () => {
    const e = await ok<{ id: string }>(organiser, "event.create", { name: "Pune Dinner", kind: "field", venue: "Old venue", brief: "Internal" });
    await ok(organiser, "event.update", {
      eventId: e.id, name: "Pune CXO Dinner", slug: "pune-cxo-dinner", startsAt: "2027-04-02T19:00:00+05:30", endsAt: "2027-04-02T22:00:00+05:30",
      description: "An evening for technology leaders.\n\nDinner is served at eight.", coverImageUrl: "https://images.example/cover.jpg", locationUrl: "https://maps.example/venue", venue: null,
    });
    const [row] = await db.select().from(event).where(eq(event.id, e.id));
    expect(row).toMatchObject({ name: "Pune CXO Dinner", slug: "pune-cxo-dinner", venue: null, brief: "Internal", coverImageUrl: "https://images.example/cover.jpg" });
    expect(row.startsAt?.toISOString()).toBe("2027-04-02T13:30:00.000Z");
    expect(row.description).toContain("Dinner is served at eight.");
  });

  it("refuses an address another event uses, a picture that is not https, and an end before the start", async () => {
    const a = await ok<{ id: string; slug: string }>(organiser, "event.create", { name: "First", kind: "field" });
    const b = await ok<{ id: string }>(organiser, "event.create", { name: "Second", kind: "field", startsAt: "2027-05-01T10:00:00+05:30" });
    expect(await invoke(db, organiser, "event.update", { eventId: b.id, slug: a.slug })).toMatchObject({ status: "error", code: "slug_taken" });
    expect((await invoke(db, organiser, "event.update", { eventId: b.id, slug: "Not A Slug" })).status).toBe("invalid");
    expect((await invoke(db, organiser, "event.update", { eventId: b.id, coverImageUrl: "http://plain.example/x.jpg" })).status).toBe("invalid");
    expect(await invoke(db, organiser, "event.update", { eventId: b.id, endsAt: "2027-05-01T09:00:00+05:30" })).toMatchObject({ status: "error", code: "bad_dates" });
    // Saving the same address again is not a clash with itself.
    expect((await invoke(db, organiser, "event.update", { eventId: a.id, slug: a.slug })).status).toBe("ok");
  });

  it("shows a stored moment as the local time it was typed in", () => {
    const iso = zonedToIso("2027-02-12T09:00", "Europe/London");
    expect(isoToZonedLocal(new Date(iso), "Europe/London")).toBe("2027-02-12T09:00");
    expect(isoToZonedLocal(new Date(iso), "Asia/Kolkata")).toBe("2027-02-12T14:30");
    expect(isoToZonedLocal(null, "Asia/Kolkata")).toBe("");
  });

  it("carries the public page over to a copy", async () => {
    const e = await ok<{ id: string }>(organiser, "event.create", { name: "Original", kind: "field" });
    await ok(organiser, "event.update", { eventId: e.id, description: "Come along.", requireApproval: true });
    const copy = await ok<{ id: string }>(organiser, "event.clone", { eventId: e.id, name: "Second edition" });
    const [row] = await db.select().from(event).where(eq(event.id, copy.id));
    expect(row).toMatchObject({ description: "Come along.", requireApproval: true, status: "draft" });
  });
});

describe("cancelling an event", () => {
  it("tells everyone holding or awaiting a place once, and nobody who declined or unsubscribed", async () => {
    const e = await liveEvent("Called Off Summit");
    for (const who of ["going", "optout", "leaving"]) await ok(site, "registration.register_guest", { eventSlug: e.slug, firstName: who, email: `${who}@cancel.test` });
    await ok(organiser, "guest.import", { eventId: e.id, rows: [{ email: "invited@cancel.test", firstName: "Invited" }] });
    await ok(site, "registration.cancel", { registrationId: (await reg(e.id, "leaving@cancel.test")).id });
    const [optout] = await db.select().from(contact).where(eq(contact.email, "optout@cancel.test"));
    await ok(site, "contact.unsubscribe", { contactId: optout.id });

    const out = await ok<{ told: number }>(organiser, "event.cancel", { eventId: e.id, message: "A new date will follow." });
    expect(out.told).toBe(2);
    const notice = (await mailTo("going@cancel.test")).find((m) => m.subject?.startsWith("Cancelled:"));
    expect(notice?.body).toContain("A new date will follow.");
    expect(notice?.body).toContain("/u/"); // still carries the way out
    expect((await mailTo("invited@cancel.test")).some((m) => m.subject?.startsWith("Cancelled:"))).toBe(true);
    expect((await mailTo("leaving@cancel.test")).some((m) => m.subject?.startsWith("Cancelled:"))).toBe(false);
    expect((await mailTo("optout@cancel.test")).some((m) => m.subject?.startsWith("Cancelled:"))).toBe(false);

    // Cancelling twice emails nobody twice, and the event no longer takes registrations.
    expect(await ok<{ told: number; already: boolean }>(organiser, "event.cancel", { eventId: e.id })).toMatchObject({ told: 0, already: true });
    expect(await invoke(db, site, "registration.register_guest", { eventSlug: e.slug, firstName: "Late", email: "late@cancel.test" })).toMatchObject({ status: "error", code: "not_open" });
    expect(await invoke(db, organiser, "event.set_status", { eventId: e.id, status: "live" })).toMatchObject({ status: "error", code: "cancelled" });
    expect((await invoke(db, organiser, "event.set_status", { eventId: e.id, status: "draft" })).status).toBe("ok");
  });

  it("is an outward-facing act: an agent's attempt waits for a person", async () => {
    const e = await liveEvent("Agent Cannot Cancel");
    const builder = await servicePrincipal(db, "Concierge").then(() => db.query.sysUser.findFirst({ where: (u, { and, eq }) => and(eq(u.name, "Builder"), eq(u.kind, "agent")) }));
    const agent = (await loadPrincipal(db, builder!.id))!;
    expect((await invoke(db, agent, "event.cancel", { eventId: e.id })).status).toBe("pending_approval");
    const [row] = await db.select().from(event).where(eq(event.id, e.id));
    expect(row.status).toBe("live");
  });
});

describe("the calendar file", () => {
  const get = (slug: string) => calendar(new Request("http://localhost/x"), { params: Promise.resolve({ slug }) });

  it("gives a live event's time, place and link, and escapes what calendars would misread", async () => {
    const e = await liveEvent("Dinner, Drinks; Talks", { venue: "Taj, Hall 2", endsAt: "2027-03-10T21:00:00+05:30" });
    const response = await get(e.slug);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/calendar");
    const text = await response.text();
    expect(text).toContain("DTSTART:20270310T123000Z");
    expect(text).toContain("DTEND:20270310T153000Z");
    expect(text).toContain("SUMMARY:Dinner\\, Drinks\\; Talks");
    expect(text).toContain("LOCATION:Taj\\, Hall 2");
    expect(text).toContain("STATUS:CONFIRMED");
    expect(text.split("\r\n").every((l) => l.length <= 75)).toBe(true);
  });

  it("does not exist for a draft, and says cancelled for a cancelled event", async () => {
    const draft = await ok<{ slug: string }>(organiser, "event.create", { name: "Secret", kind: "field", startsAt: "2027-06-01T10:00:00+05:30" });
    expect((await get(draft.slug)).status).toBe(404);
    const e = await liveEvent("Off Again");
    await ok(organiser, "event.cancel", { eventId: e.id });
    expect(await (await get(e.slug)).text()).toContain("STATUS:CANCELLED");
  });

  it("is linked from the confirmation email", async () => {
    const e = await liveEvent("With Calendar");
    await ok(site, "registration.register_guest", { eventSlug: e.slug, firstName: "Cal", email: "cal@guest.test" });
    await drainEvents(db);
    expect((await mailTo("cal@guest.test"))[0].body).toContain(`/e/${e.slug}/calendar.ics`);
  });
});

describe("more kinds of question", () => {
  it("checks phone numbers and web addresses, and will not register without the terms", async () => {
    const e = await liveEvent("Questions Galore");
    for (const [label, type] of [["Company", "company"], ["Mobile", "phone"], ["Website", "website"], ["LinkedIn", "social"], ["I agree to the code of conduct", "terms"]]) {
      await ok(organiser, "form.add_field", { eventId: e.id, purpose: "registration", label, type });
    }
    const register = (email: string, answers: Record<string, unknown>) => invoke<{ status: string }>(db, site, "registration.register_guest", { eventSlug: e.slug, firstName: "Quin", email, answers });
    expect(await register("a@q.test", { company: "Acme" })).toMatchObject({ status: "error", code: "missing_answer" });
    expect(await register("a@q.test", { i_agree_to_the_code_of_conduct: "on", mobile: "call me" })).toMatchObject({ status: "error", code: "bad_answer" });
    expect(await register("a@q.test", { i_agree_to_the_code_of_conduct: "on", website: "not a site" })).toMatchObject({ status: "error", code: "bad_answer" });
    expect((await register("a@q.test", { i_agree_to_the_code_of_conduct: "on", company: "Acme", mobile: "+91 98765 43210", website: "acme.example", linkedin: "linkedin.com/in/quin" })).status).toBe("ok");
    expect((await reg(e.id, "a@q.test")).custom).toEqual({ company: "Acme", mobile: "+91 98765 43210", website: "https://acme.example", linkedin: "linkedin.com/in/quin", i_agree_to_the_code_of_conduct: true });
  });
});

describe("events that approve each guest", () => {
  it("holds a request until someone decides, and emails the guest at each step", async () => {
    const e = await liveEvent("Invite Only", { });
    await ok(organiser, "event.update", { eventId: e.id, requireApproval: true, capacity: 1 });
    for (const who of ["first", "second", "third"]) {
      expect((await ok<{ status: string }>(site, "registration.register_guest", { eventSlug: e.slug, firstName: who, email: `${who}@approve.test` })).status).toBe("pending");
    }
    await drainEvents(db);
    expect((await mailTo("first@approve.test")).map((m) => m.subject)).toEqual([`We have your request for Invite Only`]);

    // Nobody pending holds a place, can be checked in, or is counted as registered.
    const first = await reg(e.id, "first@approve.test");
    expect(await invoke(db, desk, "registration.check_in", { registrationId: first.id })).toMatchObject({ status: "error", code: "not_approved" });

    expect(await ok(organiser, "registration.approve", { registrationId: first.id })).toMatchObject({ status: "registered", changed: true });
    expect(await ok(organiser, "registration.approve", { registrationId: (await reg(e.id, "second@approve.test")).id })).toMatchObject({ status: "waitlisted" });
    expect(await ok(organiser, "registration.decline", { registrationId: (await reg(e.id, "third@approve.test")).id })).toMatchObject({ status: "declined" });
    await drainEvents(db);
    expect((await mailTo("first@approve.test")).map((m) => m.subject)).toContain("You're registered for Invite Only");
    expect((await mailTo("second@approve.test")).map((m) => m.subject)).toContain("You're on the waitlist for Invite Only");
    expect((await mailTo("third@approve.test")).map((m) => m.subject)).toContain("About your request for Invite Only");

    // Deciding twice changes nothing.
    expect(await ok(organiser, "registration.approve", { registrationId: first.id })).toMatchObject({ changed: false });
    expect(await ok(organiser, "registration.decline", { registrationId: first.id })).toMatchObject({ status: "registered", changed: false });
  });

  it("gives someone the team invited a place straight away, and makes a returning guest ask again", async () => {
    const e = await liveEvent("Guest List Only");
    await ok(organiser, "event.update", { eventId: e.id, requireApproval: true });
    await ok(organiser, "guest.import", { eventId: e.id, rows: [{ email: "vip@approve.test", firstName: "Vip" }] });
    const vip = await reg(e.id, "vip@approve.test");
    expect(await ok(site, "registration.rsvp", { registrationId: vip.id, answer: "yes" })).toMatchObject({ status: "registered" });
    await ok(site, "registration.cancel", { registrationId: vip.id });
    expect(await ok(site, "registration.rsvp", { registrationId: vip.id, answer: "yes" })).toMatchObject({ status: "pending" });
  });

  it("is not something the door desk can decide", async () => {
    const e = await liveEvent("Desk Cannot Approve");
    await ok(organiser, "event.update", { eventId: e.id, requireApproval: true });
    await ok(site, "registration.register_guest", { eventSlug: e.slug, firstName: "Pat", email: "pat@approve.test" });
    expect((await invoke(db, desk, "registration.approve", { registrationId: (await reg(e.id, "pat@approve.test")).id })).status).toBe("denied");
  });
});

describe("at the door", () => {
  it("takes back a check-in, with the PIN and any survey answer", async () => {
    const e = await liveEvent("Door Test");
    await ok(site, "registration.register_guest", { eventSlug: e.slug, firstName: "Uma", email: "uma@door.test" });
    const r = await reg(e.id, "uma@door.test");
    await ok(desk, "registration.check_in", { registrationId: r.id });
    await ok(site, "survey.submit", { registrationId: r.id, score: 8 });
    expect(await ok(desk, "registration.undo_check_in", { registrationId: r.id })).toEqual({ undone: true });
    expect(await reg(e.id, "uma@door.test")).toMatchObject({ status: "registered", pin: null, checkedInAt: null });
    expect(await db.select().from(surveyResponse).where(eq(surveyResponse.registrationId, r.id))).toHaveLength(0);
    expect(await ok(desk, "registration.undo_check_in", { registrationId: r.id })).toEqual({ undone: false });
    // And they can come in again.
    expect((await ok<{ alreadyCheckedIn: boolean }>(desk, "registration.check_in", { registrationId: r.id })).alreadyCheckedIn).toBe(false);
  });

  it("registers and checks in a walk-in in one step, even when the event is full, without emailing them", async () => {
    const e = await liveEvent("Full House");
    await ok(organiser, "event.update", { eventId: e.id, capacity: 1 });
    await ok(site, "registration.register_guest", { eventSlug: e.slug, firstName: "Seat", email: "seat@door.test" });
    await drainEvents(db);

    const walk = await ok<{ pin: string; alreadyCheckedIn: boolean }>(desk, "registration.walk_in", { eventId: e.id, firstName: "Wanda", email: " Wanda@Door.test " });
    expect(walk.pin).toMatch(/^\d{6}$/);
    expect(await reg(e.id, "wanda@door.test")).toMatchObject({ status: "attended", source: "walk-in" });
    await drainEvents(db);
    expect(await mailTo("wanda@door.test")).toHaveLength(0);
    // Doing it again finds them rather than making a second registration.
    expect(await ok(desk, "registration.walk_in", { eventId: e.id, firstName: "Wanda", email: "wanda@door.test" })).toMatchObject({ alreadyCheckedIn: true, pin: walk.pin });
  });

  it("checks in a walk-in who was already on the list, and never rewrites an existing contact", async () => {
    const e = await liveEvent("Known Face");
    await ok(site, "registration.register_guest", { eventSlug: e.slug, firstName: "Real", lastName: "Name", email: "real@door.test" });
    await ok(desk, "registration.walk_in", { eventId: e.id, firstName: "Typo", email: "real@door.test" });
    const [c] = await db.select().from(contact).where(eq(contact.email, "real@door.test"));
    expect(c.firstName).toBe("Real");
    expect(await db.select().from(registration).where(and(eq(registration.eventId, e.id), eq(registration.contactId, c.id)))).toHaveLength(1);
    expect(await reg(e.id, "real@door.test")).toMatchObject({ status: "attended", source: "web" });
  });

  it("does not take walk-ins for a cancelled event", async () => {
    const e = await liveEvent("No Entry");
    await ok(organiser, "event.cancel", { eventId: e.id });
    expect(await invoke(db, desk, "registration.walk_in", { eventId: e.id, firstName: "Nope", email: "nope@door.test" })).toMatchObject({ status: "error", code: "not_open" });
  });
});

describe("managing the team", () => {
  it("changes a role, and the change is what the person can do next", async () => {
    const id = await createUser(db, { name: "Sana", kind: "human", email: "sana@team.test", roles: ["desk"] });
    expect((await loadPrincipal(db, id))!.permissions.has("event.write")).toBe(false);
    await ok(admin, "user.set_role", { userId: id, role: "organiser" });
    const after = (await loadPrincipal(db, id))!;
    expect(after.permissions.has("event.write")).toBe(true);
    expect(after.permissions.has("admin.manage")).toBe(false);
    expect((await invoke(db, organiser, "user.set_role", { userId: id, role: "admin" })).status).toBe("denied");
  });

  it("switches an account off, signing the person out, and back on", async () => {
    const id = await createUser(db, { name: "Leo", kind: "human", email: "leo@team.test", roles: ["sales"] });
    await setPassword(db, id, "correct horse battery");
    expect(await signIn(db, "leo@team.test", "correct horse battery")).toBeTruthy();
    await ok(admin, "user.set_active", { userId: id, active: false });
    expect(await db.select().from(sysSession).where(eq(sysSession.userId, id))).toHaveLength(0);
    expect(await signIn(db, "leo@team.test", "correct horse battery")).toBeNull();
    expect(await loadPrincipal(db, id)).toBeNull();
    await ok(admin, "user.set_active", { userId: id, active: true });
    expect(await signIn(db, "leo@team.test", "correct horse battery")).toBeTruthy();
  });

  it("never leaves the instance without an administrator", async () => {
    // Ada is the only administrator here.
    expect(await invoke(db, admin, "user.set_role", { userId: admin.id, role: "organiser" })).toMatchObject({ status: "error", code: "last_admin" });
    expect(await invoke(db, admin, "user.set_active", { userId: admin.id, active: false })).toMatchObject({ status: "error", code: "self" });
    const second = await person("Bea", "admin");
    expect((await invoke(db, admin, "user.set_role", { userId: second.id, role: "sales" })).status).toBe("ok");
    expect(await invoke(db, admin, "user.set_role", { userId: admin.id, role: "organiser" })).toMatchObject({ status: "error", code: "last_admin" });
  });

  it("applies to people only", async () => {
    const builder = await db.query.sysUser.findFirst({ where: (u, { and, eq }) => and(eq(u.name, "Builder"), eq(u.kind, "agent")) });
    expect(await invoke(db, admin, "user.set_active", { userId: builder!.id, active: false })).toMatchObject({ status: "error", code: "not_found" });
    expect(await invoke(db, admin, "user.set_role", { userId: builder!.id, role: "admin" })).toMatchObject({ status: "error", code: "not_found" });
  });
});

describe("what was there before still holds", () => {
  it("leaves an ordinary event registering guests straight into a place", async () => {
    const e = await liveEvent("Ordinary");
    expect((await ok<{ status: string }>(site, "registration.register_guest", { eventSlug: e.slug, firstName: "Norm", email: "norm@guest.test" })).status).toBe("registered");
    expect(await db.select().from(eventSession).where(eq(eventSession.eventId, e.id))).toHaveLength(0);
  });
});
