/** Shared counters, leases and the one-pass worker used on hosts with no long-running process. */
import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { openDb, type Db } from "@/db/client";
import { sysOutbox, sysProperty, task } from "@/db/schema";
import { setModel } from "@/agents/model";
import { acquireLease, limitClear, limitCount, limitHit, releaseLease, sweepLimits } from "@/platform/limits";
import { createUser, ensurePlatform } from "@/platform/seed";
import { loadPrincipal } from "@/platform/principal";
import { tick } from "@/platform/tick";
import { invoke } from "@/platform/tools";
import "@/tools";
import "@/rules";

let db: Db;

beforeAll(async () => {
  db = await openDb();
  await ensurePlatform(db);
  setModel(null);
});

describe("limits", () => {
  it("counts hits inside a window and starts again after it", async () => {
    const t0 = 1_000_000;
    expect(await limitCount(db, "a", t0)).toBe(0);
    expect(await limitHit(db, "a", 1000, t0)).toBe(1);
    expect(await limitHit(db, "a", 1000, t0 + 10)).toBe(2);
    expect(await limitCount(db, "a", t0 + 20)).toBe(2);
    expect(await limitCount(db, "a", t0 + 2000)).toBe(0);
    expect(await limitHit(db, "a", 1000, t0 + 2000)).toBe(1);
    await limitClear(db, "a");
    expect(await limitCount(db, "a", t0 + 2001)).toBe(0);
  });

  it("does not lose hits made at the same moment", async () => {
    const counts = await Promise.all(Array.from({ length: 8 }, () => limitHit(db, "b", 60_000)));
    expect(counts.sort((x, y) => x - y)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it("sweeps finished windows and leaves other properties alone", async () => {
    await db.insert(sysProperty).values({ key: "playbook", value: "Be brief." });
    await limitHit(db, "old", 1000, 5_000);
    await limitHit(db, "current", 60_000);
    await sweepLimits(db);
    expect(await db.select().from(sysProperty).where(eq(sysProperty.key, "limit:old"))).toHaveLength(0);
    expect(await limitCount(db, "current")).toBe(1);
    expect((await db.select().from(sysProperty).where(eq(sysProperty.key, "playbook")))[0].value).toBe("Be brief.");
  });
});

describe("leases", () => {
  it("lets one holder in at a time, and a new one after release or expiry", async () => {
    const first = await acquireLease(db, "job", 60_000, 1000);
    expect(first).not.toBeNull();
    expect(await acquireLease(db, "job", 60_000, 2000)).toBeNull();
    await releaseLease(db, "job", first!);
    const second = await acquireLease(db, "job", 60_000, 3000);
    expect(second).not.toBeNull();
    // Expired: someone else may take it, and the old holder's release no longer removes it.
    const third = await acquireLease(db, "job", 60_000, 3000 + 60_001);
    expect(third).not.toBeNull();
    await releaseLease(db, "job", second!);
    expect(await acquireLease(db, "job", 60_000, 3000 + 60_002)).toBeNull();
    await releaseLease(db, "job", third!);
  });
});

describe("tick", () => {
  it("delivers events and sends the messages they queue, in one pass", async () => {
    const adminId = await createUser(db, { name: "Tick Admin", kind: "human", email: "tick@acme.test", roles: ["admin"] });
    const admin = (await loadPrincipal(db, adminId))!;
    const made = await invoke<{ id: string }>(db, admin, "event.create", { name: "Tick Summit", kind: "field" });
    expect(made.status).toBe("ok");
    const eventId = (made as { output: { id: string } }).output.id;
    const person = await invoke<{ id: string }>(db, admin, "contact.upsert", { email: "guest@acme.test", firstName: "Guest" });
    const contactId = (person as { output: { id: string } }).output.id;
    expect((await invoke(db, admin, "registration.create", { eventId, contactId })).status).toBe("ok");

    const result = await tick(db);
    expect(result.skipped).toBe(false);
    if (result.skipped) return;
    expect(result.events).toBeGreaterThan(0);
    expect(result.sent).toBe(1);
    const [mail] = await db.select().from(sysOutbox).where(eq(sysOutbox.contactId, contactId));
    expect(mail.status).toBe("sent");
    expect(mail.subject).toContain("Tick Summit");
  });

  it("stands aside while another pass holds the lease", async () => {
    const lease = await acquireLease(db, "tick", 60_000);
    expect(await tick(db)).toEqual({ skipped: true });
    await releaseLease(db, "tick", lease!);
    expect((await tick(db)).skipped).toBe(false);
  });

  it("closes an agent run that was cut off part-way", async () => {
    const old = new Date(Date.now() - 20 * 60_000);
    const [run] = await db.insert(task).values({ number: "RUN9999001", taskType: "agent_run", state: "in_progress", shortDescription: "Cut off", payload: { agent: "Analyst", goal: "x" }, updatedAt: old }).returning({ id: task.id });
    const [recent] = await db.insert(task).values({ number: "RUN9999002", taskType: "agent_run", state: "in_progress", shortDescription: "Still going", payload: { agent: "Analyst", goal: "x" } }).returning({ id: task.id });
    await tick(db);
    const [closed] = await db.select().from(task).where(eq(task.id, run.id));
    expect(closed.state).toBe("failed");
    expect(closed.payload.error).toContain("interrupted");
    expect(closed.payload.goal).toBe("x");
    expect((await db.select().from(task).where(eq(task.id, recent.id)))[0].state).toBe("in_progress");
  });
});
