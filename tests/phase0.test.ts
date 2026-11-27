/** Phase 0: who may see what, a person's rights over their data, and events outside India. */
import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { openDb, type Db } from "@/db/client";
import { contact, event, lead, registration, surveyResponse, sysAudit, sysJournal, sysOutbox } from "@/db/schema";
import { drainEvents } from "@/platform/events";
import { DEFAULT_ROLES } from "@/platform/permissions";
import { loadPrincipal, type Principal } from "@/platform/principal";
import { createUser, ensurePlatform, servicePrincipal } from "@/platform/seed";
import { invoke } from "@/platform/tools";
import "@/rules";

let db: Db;
let admin: Principal;
let organiser: Principal;
let site: Principal;

const ok = async <T>(who: Principal, tool: string, input: unknown): Promise<T> => {
  const result = await invoke<T>(db, who, tool, input);
  if (result.status !== "ok") throw new Error(`${tool}: ${JSON.stringify(result)}`);
  return result.output;
};

beforeAll(async () => {
  db = await openDb();
  await ensurePlatform(db);
  admin = (await loadPrincipal(db, await createUser(db, { name: "Ada", kind: "human", email: "ada@example.test", roles: ["admin"] })))!;
  organiser = (await loadPrincipal(db, await createUser(db, { name: "Omar", kind: "human", email: "omar@example.test", roles: ["organiser"] })))!;
  site = await servicePrincipal(db, "Public site");
});

describe("who may see what", () => {
  it("keeps budgets, the ledger and the team away from the door desk", () => {
    expect(DEFAULT_ROLES.desk).not.toContain("insights.read");
    expect(DEFAULT_ROLES.desk).not.toContain("audit.read");
    expect(DEFAULT_ROLES.desk).not.toContain("admin.manage");
    expect(DEFAULT_ROLES.sales).toContain("insights.read");
    expect(DEFAULT_ROLES.sales).not.toContain("audit.read");
    expect(DEFAULT_ROLES.organiser).toEqual(expect.arrayContaining(["insights.read", "audit.read"]));
  });

  it("gives no agent or service account the new viewing permissions", () => {
    for (const [role, permissions] of Object.entries(DEFAULT_ROLES)) {
      if (!role.startsWith("agent_") && role !== "system" && role !== "public_site") continue;
      expect(permissions).not.toContain("insights.read");
      expect(permissions).not.toContain("audit.read");
    }
  });
});

describe("a person's data", () => {
  let eventId: string;
  let slug: string;

  beforeAll(async () => {
    const e = await ok<{ id: string; slug: string }>(organiser, "event.create", { name: "Privacy Summit", kind: "conference" });
    eventId = e.id;
    slug = e.slug;
    await ok(organiser, "event.set_status", { eventId, status: "live" });
    for (const [firstName, email] of [["Priya", "priya@guest.test"], ["Sam", "sam@guest.test"]]) {
      await ok(site, "registration.register_guest", { eventSlug: slug, firstName, email });
    }
    await drainEvents(db); // queues each confirmation email
    const [priya] = await db.select().from(contact).where(eq(contact.email, "priya@guest.test"));
    const [reg] = await db.select().from(registration).where(eq(registration.contactId, priya.id));
    await ok(organiser, "registration.check_in", { registrationId: reg.id });
    await ok(site, "survey.submit", { registrationId: reg.id, score: 9, comment: "Loved it" });
    const captured = await ok<{ id: string }>(organiser, "lead.capture", { eventId, contactId: priya.id, notes: "Wants a demo" });
    await ok(organiser, "lead.score", { leadId: captured.id, score: 80, reason: "Asked for a demo" });
    await ok(organiser, "note.add", { table: "contact", recordId: priya.id, body: "Met at the stand" });
  });

  it("is for administrators only", async () => {
    expect((await invoke(db, organiser, "contact.export", { email: "priya@guest.test" })).status).toBe("denied");
    expect((await invoke(db, organiser, "contact.erase", { email: "priya@guest.test", confirm: true })).status).toBe("denied");
  });

  it("exports everything held about one person, and keeps it out of the ledger", async () => {
    const data = await ok<{ contact: { email: string }; registrations: unknown[]; leads: { notes: string }[]; surveys: { score: number }[]; messages: unknown[]; notes: { body: string }[] }>(admin, "contact.export", { email: " Priya@Guest.test " });
    expect(data.contact.email).toBe("priya@guest.test");
    expect(data.registrations).toHaveLength(1);
    expect(data.leads[0].notes).toBe("Wants a demo");
    expect(data.surveys[0].score).toBe(9);
    expect(data.messages.length).toBeGreaterThan(0);
    expect(data.notes.map((n) => n.body)).toEqual(expect.arrayContaining(["Met at the stand", expect.stringContaining("Scored 80")]));

    const [row] = await db.select().from(sysAudit).where(eq(sysAudit.tool, "contact.export"));
    expect(JSON.stringify(row)).not.toContain("priya@guest.test");
    expect(JSON.stringify(row)).not.toContain("Wants a demo");
  });

  it("says so when nobody has that email", async () => {
    const result = await invoke(db, admin, "contact.export", { email: "nobody@guest.test" });
    expect(result).toMatchObject({ status: "error", code: "not_found" });
  });

  it("will not erase without the confirmation", async () => {
    expect((await invoke(db, admin, "contact.erase", { email: "priya@guest.test" })).status).toBe("invalid");
    expect(await db.select().from(contact).where(eq(contact.email, "priya@guest.test"))).toHaveLength(1);
  });

  it("erases one person completely and leaves everyone else alone", async () => {
    const [priya] = await db.select().from(contact).where(eq(contact.email, "priya@guest.test"));
    const out = await ok<{ registrations: number; leads: number; messages: number; ledgerEntries: number }>(admin, "contact.erase", { email: "priya@guest.test", confirm: true });
    expect(out).toMatchObject({ registrations: 1, leads: 1 });
    expect(out.messages).toBeGreaterThan(0);
    expect(out.ledgerEntries).toBeGreaterThan(0);

    expect(await db.select().from(contact).where(eq(contact.email, "priya@guest.test"))).toHaveLength(0);
    expect(await db.select().from(registration).where(eq(registration.contactId, priya.id))).toHaveLength(0);
    expect(await db.select().from(lead).where(eq(lead.contactId, priya.id))).toHaveLength(0);
    expect(await db.select().from(sysOutbox).where(eq(sysOutbox.recipient, "priya@guest.test"))).toHaveLength(0);
    expect(await db.select().from(surveyResponse)).toHaveLength(0);
    expect((await db.select().from(sysJournal)).some((n) => n.body.includes("Met at the stand") || n.body.includes("Scored 80"))).toBe(false);

    // Nothing left in the ledger names her, by email or by record.
    const ledger = JSON.stringify(await db.select().from(sysAudit));
    expect(ledger).not.toContain("priya@guest.test");
    expect(ledger).not.toContain(priya.id);
    expect(ledger).not.toContain("Wants a demo");

    // The other guest is untouched.
    const [sam] = await db.select().from(contact).where(eq(contact.email, "sam@guest.test"));
    expect(await db.select().from(registration).where(eq(registration.contactId, sam.id))).toHaveLength(1);
    expect(await db.select().from(sysOutbox).where(eq(sysOutbox.recipient, "sam@guest.test"))).not.toHaveLength(0);
    expect(ledger).toContain("sam@guest.test");
  });
});

describe("events outside India", () => {
  it("takes a time zone and currency when created, and refuses ones that do not exist", async () => {
    const e = await ok<{ id: string }>(organiser, "event.create", { name: "London Dinner", kind: "field", timezone: "Europe/London", currency: "gbp" });
    const [row] = await db.select().from(event).where(eq(event.id, e.id));
    expect(row).toMatchObject({ timezone: "Europe/London", currency: "GBP" });
    expect((await invoke(db, organiser, "event.create", { name: "Nowhere", kind: "field", timezone: "Mars/Olympus" })).status).toBe("invalid");
    expect((await invoke(db, organiser, "event.create", { name: "Nowhere", kind: "field", currency: "POUNDS" })).status).toBe("invalid");
  });

  it("lets both be changed later without touching the rest of the event", async () => {
    const e = await ok<{ id: string }>(organiser, "event.create", { name: "Austin Booth", kind: "booth", venue: "Hall 2" });
    await ok(organiser, "event.update", { eventId: e.id, capacity: 40 });
    await ok(organiser, "event.update", { eventId: e.id, timezone: "America/Chicago", currency: "USD" });
    const [row] = await db.select().from(event).where(eq(event.id, e.id));
    expect(row).toMatchObject({ timezone: "America/Chicago", currency: "USD", capacity: 40, venue: "Hall 2" });
    expect((await invoke(db, organiser, "event.update", { eventId: e.id, timezone: "Not/AZone" })).status).toBe("invalid");
  });
});
