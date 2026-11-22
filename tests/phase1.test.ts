/** Phase 1, slice 1: sign-in, public registration and the confirmation rule. */
import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { openDb, type Db } from "@/db/client";
import { contact, sysAudit, sysOutbox } from "@/db/schema";
import { principalForSession, setPassword, signIn, signOut } from "@/platform/auth";
import { drainEvents } from "@/platform/events";
import { drainOutbox, setDriver } from "@/platform/outbox";
import { loadPrincipal, type Principal } from "@/platform/principal";
import { createUser, ensurePlatform, servicePrincipal } from "@/platform/seed";
import { invoke } from "@/platform/tools";
import "@/rules";

let db: Db;
let organiser: Principal;
let site: Principal;

beforeAll(async () => {
  db = await openDb();
  await ensurePlatform(db);
  await ensurePlatform(db); // safe to run twice
  const id = await createUser(db, { name: "Asha", kind: "human", email: "asha@example.test", roles: ["organiser"] });
  await setPassword(db, id, "correct horse battery");
  organiser = (await loadPrincipal(db, id))!;
  site = await servicePrincipal(db, "Public site");
});

describe("sign-in", () => {
  it("accepts the right password, refuses a wrong one and an unknown email alike", async () => {
    expect(await signIn(db, "asha@example.test", "wrong password")).toBeNull();
    expect(await signIn(db, "nobody@example.test", "correct horse battery")).toBeNull();
    const token = await signIn(db, " Asha@Example.test ", "correct horse battery");
    expect(token).toBeTruthy();
    expect((await principalForSession(db, token!))?.name).toBe("Asha");
    await signOut(db, token!);
    expect(await principalForSession(db, token!)).toBeNull();
  });

  it("never lets an agent or service account sign in", async () => {
    const id = await createUser(db, { name: "Builder", kind: "agent", email: "builder@example.test", roles: ["agent_builder"] });
    await setPassword(db, id, "correct horse battery");
    expect(await signIn(db, "builder@example.test", "correct horse battery")).toBeNull();
  });
});

describe("public registration", () => {
  let slug: string;
  const guest = { email: "Priya@Acme.test", firstName: "Priya", phone: "+919876543210", whatsappOptIn: true };

  it("is closed until the event is live", async () => {
    const created = await invoke<{ id: string; slug: string }>(db, organiser, "event.create", { name: "AI Expo Booth", kind: "booth", venue: "Hall 3" });
    if (created.status !== "ok") throw new Error("setup failed");
    slug = created.output.slug;
    expect(await invoke(db, site, "registration.register_guest", { eventSlug: slug, ...guest })).toMatchObject({ status: "error", code: "not_open" });
    expect((await invoke(db, organiser, "event.set_status", { eventId: created.output.id, status: "live" })).status).toBe("ok");
  });

  it("registers a guest once and records the WhatsApp opt-in", async () => {
    expect(await invoke(db, site, "registration.register_guest", { eventSlug: slug, ...guest })).toMatchObject({ status: "ok", output: { created: true } });
    expect(await invoke(db, site, "registration.register_guest", { eventSlug: slug, ...guest })).toMatchObject({ status: "ok", output: { created: false } });
    const [person] = await db.select().from(contact).where(eq(contact.email, "priya@acme.test"));
    expect(person.whatsappOptInAt).toBeInstanceOf(Date);
  });

  it("cannot be used to rewrite an existing contact", async () => {
    await invoke(db, site, "registration.register_guest", { eventSlug: slug, email: "priya@acme.test", firstName: "Mallory", phone: "+10000000000" });
    const [person] = await db.select().from(contact).where(eq(contact.email, "priya@acme.test"));
    expect([person.firstName, person.phone]).toEqual(["Priya", "+919876543210"]);
  });

  it("gives the public site nothing beyond registration", async () => {
    expect((await invoke(db, site, "event.create", { name: "Sneaky", kind: "booth" })).status).toBe("denied");
    expect((await invoke(db, site, "contact.upsert", { email: "x@y.test", firstName: "X" })).status).toBe("denied");
  });

  it("sends one confirmation email through the System account", async () => {
    const sent: string[] = [];
    setDriver("email", async (m) => void sent.push(`${m.recipient}|${m.subject}`));
    await drainEvents(db);
    await drainEvents(db);
    await drainOutbox(db);
    expect(sent).toEqual(["priya@acme.test|You're registered for AI Expo Booth"]);
    const [queued] = await db.select().from(sysOutbox);
    expect(queued.status).toBe("sent");
    const calls = await db.select().from(sysAudit).where(eq(sysAudit.tool, "message.send"));
    expect(calls.map((c) => [c.actorKind, c.status])).toEqual([["service", "ok"]]);
  });
});
