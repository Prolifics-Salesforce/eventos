/** A guest's own account: a link by email, no password, and a cookie nobody can forge. */
import { beforeAll, describe, expect, it } from "vitest";
import { and, eq, like } from "drizzle-orm";
import { openDb, type Db } from "@/db/client";
import { contact, sysAudit, sysOutbox, sysProperty } from "@/db/schema";
import { guestCookieValue, readGuestCookie } from "@/lib/guest";
import { drainEvents } from "@/platform/events";
import { DEFAULT_ROLES } from "@/platform/permissions";
import { loadPrincipal, type Principal } from "@/platform/principal";
import { createUser, ensurePlatform, servicePrincipal } from "@/platform/seed";
import { invoke } from "@/platform/tools";
import "@/rules";

let db: Db;
let organiser: Principal;
let site: Principal;
let slug: string;

const ok = async <T>(who: Principal, tool: string, input: unknown): Promise<T> => {
  const result = await invoke<T>(db, who, tool, input);
  if (result.status !== "ok") throw new Error(`${tool}: ${JSON.stringify(result)}`);
  return result.output;
};
const links = async (email: string) => (await db.select().from(sysOutbox).where(and(eq(sysOutbox.recipient, email), eq(sysOutbox.subject, "Your events and passes")))).map((m) => m.body.match(/\/my\/enter\/([\w-]+)/)![1]);

beforeAll(async () => {
  db = await openDb();
  await ensurePlatform(db);
  organiser = (await loadPrincipal(db, await createUser(db, { name: "Omar", kind: "human", email: "omar@team.test", roles: ["organiser"] })))!;
  site = await servicePrincipal(db, "Public site");
  const e = await ok<{ id: string; slug: string }>(organiser, "event.create", { name: "Portal Summit", kind: "field", startsAt: "2027-06-01T10:00:00+05:30" });
  slug = e.slug;
  await ok(organiser, "event.set_status", { eventId: e.id, status: "live" });
  await ok(site, "registration.register_guest", { eventSlug: slug, firstName: "Gita", email: "gita@guest.test" });
  await drainEvents(db);
});

describe("asking for the link", () => {
  it("emails a registered guest a link that signs them in once", async () => {
    expect(await ok(site, "guest.request_link", { email: " Gita@Guest.test " })).toEqual({ sent: true });
    const [token] = await links("gita@guest.test");
    const [gita] = await db.select().from(contact).where(eq(contact.email, "gita@guest.test"));
    expect(await ok(site, "guest.sign_in", { token })).toEqual({ contactId: gita.id });
    expect(await invoke(db, site, "guest.sign_in", { token })).toMatchObject({ status: "error", code: "bad_link" });
  });

  it("says the same for an email that is on no list, and sends it nothing", async () => {
    await ok(organiser, "contact.upsert", { email: "nolist@guest.test", firstName: "Nolist" }); // a contact with no registration
    for (const email of ["stranger@guest.test", "nolist@guest.test", "not an email"]) expect(await ok(site, "guest.request_link", { email })).toEqual({ sent: true });
    expect(await links("stranger@guest.test")).toHaveLength(0);
    expect(await links("nolist@guest.test")).toHaveLength(0);
  });

  it("still reaches a guest who has unsubscribed from event emails", async () => {
    await ok(site, "registration.register_guest", { eventSlug: slug, firstName: "Una", email: "una@guest.test" });
    const [una] = await db.select().from(contact).where(eq(contact.email, "una@guest.test"));
    await ok(site, "contact.unsubscribe", { contactId: una.id });
    await ok(site, "guest.request_link", { email: "una@guest.test" });
    expect(await links("una@guest.test")).toHaveLength(1);
  });

  it("keeps only the newest link alive, and lets one expire", async () => {
    await ok(site, "guest.request_link", { email: "gita@guest.test" });
    await ok(site, "guest.request_link", { email: "gita@guest.test" });
    const all = await links("gita@guest.test");
    const [older, newest] = all.slice(-2);
    expect(await invoke(db, site, "guest.sign_in", { token: older })).toMatchObject({ status: "error", code: "bad_link" });

    const [gita] = await db.select().from(contact).where(eq(contact.email, "gita@guest.test"));
    // Another guest has an unused link too; age only this guest's.
    const row = (await db.select().from(sysProperty).where(like(sysProperty.key, "guestlink:%"))).find((r) => r.value.includes(gita.id))!;
    await db.update(sysProperty).set({ value: JSON.stringify({ contactId: gita.id, until: Date.now() - 1000 }) }).where(eq(sysProperty.key, row.key));
    expect(await invoke(db, site, "guest.sign_in", { token: newest })).toMatchObject({ status: "error", code: "bad_link" });
  });

  it("keeps the email and the link out of the ledger, and is done only by the public site", async () => {
    const ledger = JSON.stringify(await db.select().from(sysAudit).where(like(sysAudit.tool, "guest.%")));
    expect(ledger).not.toContain("gita@guest.test");
    for (const token of await links("gita@guest.test")) expect(ledger).not.toContain(token);
    expect((await invoke(db, organiser, "guest.request_link", { email: "gita@guest.test" })).status).toBe("denied");
    for (const [role, permissions] of Object.entries(DEFAULT_ROLES)) expect(permissions.includes("guest.portal")).toBe(role === "public_site" || role === "admin");
  });
});

describe("staying signed in", () => {
  it("accepts its own cookie and nobody else's", async () => {
    const [gita] = await db.select().from(contact).where(eq(contact.email, "gita@guest.test"));
    const [una] = await db.select().from(contact).where(eq(contact.email, "una@guest.test"));
    const cookie = await guestCookieValue(db, gita.id);
    expect(await readGuestCookie(db, cookie)).toBe(gita.id);

    // Swapping in another guest's id, or stretching the date, breaks the signature.
    const [payload, mac] = cookie.split(".");
    expect(await readGuestCookie(db, `${payload.replace(gita.id, una.id)}.${mac}`)).toBeNull();
    expect(await readGuestCookie(db, `${gita.id}~${Date.now() + 10 * 365 * 86_400_000}.${mac}`)).toBeNull();
    expect(await readGuestCookie(db, "nonsense")).toBeNull();
    expect(await readGuestCookie(db, "")).toBeNull();
  });

  it("stops working after 30 days", async () => {
    const [gita] = await db.select().from(contact).where(eq(contact.email, "gita@guest.test"));
    const cookie = await guestCookieValue(db, gita.id);
    expect(await readGuestCookie(db, cookie, Date.now() + 29 * 86_400_000)).toBe(gita.id);
    expect(await readGuestCookie(db, cookie, Date.now() + 31 * 86_400_000)).toBeNull();
  });

  it("is not a way in to the team's screens: a guest cookie is not a session", async () => {
    const { principalForSession } = await import("@/platform/auth");
    const [gita] = await db.select().from(contact).where(eq(contact.email, "gita@guest.test"));
    expect(await principalForSession(db, await guestCookieValue(db, gita.id))).toBeNull();
  });
});

describe("where guests hear about it", () => {
  it("is linked from the confirmation email", async () => {
    const [mail] = await db.select().from(sysOutbox).where(and(eq(sysOutbox.recipient, "gita@guest.test"), like(sysOutbox.subject, "You're registered%")));
    expect(mail.body).toMatch(/All your events and passes: .*\/my/);
  });
});
