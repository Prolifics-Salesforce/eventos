import { and, asc, eq, lte, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { sysOutbox, type Channel } from "@/db/schema";

export type OutboxMessage = typeof sysOutbox.$inferSelect;
/** A driver delivers one message or throws. Email, WhatsApp and webhooks each get one. */
export type Driver = (message: OutboxMessage) => Promise<void>;

// Kept on globalThis for the same reason as the event subscribers: a driver set through one copy of
// this module must be the one used by a drain running in another.
const holder = globalThis as unknown as { __eventosDrivers?: Map<Channel, Driver> };
const drivers = (holder.__eventosDrivers ??= new Map<Channel, Driver>());
export function setDriver(channel: Channel, driver: Driver): void {
  drivers.set(channel, driver);
}

/** Default driver: prints instead of sending, so nothing leaves a dev machine by accident. */
export const consoleDriver: Driver = async (m) => {
  console.log(`[outbox:${m.channel}] to=${m.recipient} subject=${m.subject ?? ""}\n${m.body}`);
};

export type Enqueue = Pick<OutboxMessage, "channel" | "recipient" | "body"> &
  Partial<Pick<OutboxMessage, "subject" | "meta" | "contactId" | "eventId" | "dedupeKey" | "createdBy" | "nextAttemptAt">>;

/** Queue a message. Returns null when the dedupe key was already used. */
export async function enqueue(db: Db, message: Enqueue): Promise<string | null> {
  const [row] = await db.insert(sysOutbox).values(message).onConflictDoNothing().returning({ id: sysOutbox.id });
  return row?.id ?? null;
}

const MAX_ATTEMPTS = 6;
const STUCK_AFTER_MS = 5 * 60_000;

/** Send what is due. Failures back off and retry; rows stranded by a crash are reclaimed. */
export async function drainOutbox(db: Db, limit = 25): Promise<{ sent: number; failed: number }> {
  const now = new Date();
  await db
    .update(sysOutbox)
    .set({ status: "pending", lockedAt: null })
    .where(and(eq(sysOutbox.status, "sending"), lte(sysOutbox.lockedAt, new Date(now.getTime() - STUCK_AFTER_MS))));

  // Claim in one short transaction, deliver outside it: a slow provider must not hold locks.
  const claimed = await db.transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(sysOutbox)
      .where(and(eq(sysOutbox.status, "pending"), lte(sysOutbox.nextAttemptAt, now)))
      .orderBy(asc(sysOutbox.createdAt))
      .limit(limit)
      .for("update", { skipLocked: true });
    for (const row of rows) {
      await tx.update(sysOutbox).set({ status: "sending", lockedAt: now }).where(eq(sysOutbox.id, row.id));
    }
    return rows;
  });

  let sent = 0;
  let failed = 0;
  for (const row of claimed) {
    try {
      await (drivers.get(row.channel) ?? consoleDriver)(row);
      await db.update(sysOutbox).set({ status: "sent", sentAt: new Date(), lockedAt: null }).where(eq(sysOutbox.id, row.id));
      sent++;
    } catch (error) {
      const attempts = row.attempts + 1;
      await db
        .update(sysOutbox)
        .set({
          status: attempts >= MAX_ATTEMPTS ? "failed" : "pending",
          attempts,
          lockedAt: null,
          lastError: String(error instanceof Error ? error.message : error),
          nextAttemptAt: sql`now() + make_interval(secs => ${Math.min(3600, 30 * 2 ** attempts)})`,
        })
        .where(eq(sysOutbox.id, row.id));
      failed++;
    }
  }
  return { sent, failed };
}
