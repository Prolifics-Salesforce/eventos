import { asc, eq, isNull, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { sysEvent } from "@/db/schema";

export type DomainEvent = { id: number; name: string; payload: Record<string, unknown>; actorId: string | null; at: Date };
export type Subscriber = (db: Db, event: DomainEvent) => Promise<void>;

const subscribers = new Map<string, Subscriber[]>();

/** Register a reaction to a domain event. "*" receives everything. Rules, webhooks and agents all subscribe here. */
export function subscribe(name: string, fn: Subscriber): () => void {
  const list = subscribers.get(name) ?? [];
  list.push(fn);
  subscribers.set(name, list);
  return () => void list.splice(list.indexOf(fn), 1);
}

/** Record an event. Call with the transaction that made the change, so both commit or neither does. */
export async function emit(db: Db, name: string, payload: Record<string, unknown>, actorId?: string): Promise<void> {
  await db.insert(sysEvent).values({ name, payload, actorId: actorId ?? null });
}

const MAX_ATTEMPTS = 5;

/**
 * Deliver pending events to subscribers, oldest first. Delivery is
 * at-least-once: a subscriber that throws leaves the event pending for the
 * next drain, so subscribers must be safe to run twice.
 */
export async function drainEvents(db: Db, limit = 50): Promise<{ delivered: number; failed: number }> {
  let delivered = 0;
  let failed = 0;
  // Each event is tried once per drain: a failure waits for the next drain and does not block later events.
  let cursor = 0;
  for (let i = 0; i < limit; i++) {
    const outcome = await db.transaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(sysEvent)
        .where(sql`${isNull(sysEvent.processedAt)} and ${sysEvent.attempts} < ${MAX_ATTEMPTS} and ${sysEvent.id} > ${cursor}`)
        .orderBy(asc(sysEvent.id))
        .limit(1)
        .for("update", { skipLocked: true });
      if (!row) return "empty" as const;
      cursor = row.id;
      const fns = [...(subscribers.get(row.name) ?? []), ...(subscribers.get("*") ?? [])];
      try {
        // A nested transaction, so a failing subscriber undoes its own writes but not our bookkeeping.
        await tx.transaction(async (inner) => {
          for (const fn of fns) await fn(inner as Db, row);
        });
        await tx.update(sysEvent).set({ processedAt: new Date() }).where(eq(sysEvent.id, row.id));
        return "ok" as const;
      } catch (error) {
        await tx
          .update(sysEvent)
          .set({ attempts: row.attempts + 1, lastError: String(error instanceof Error ? error.message : error) })
          .where(eq(sysEvent.id, row.id));
        return "failed" as const;
      }
    });
    if (outcome === "empty") break;
    if (outcome === "ok") delivered++;
    else failed++;
  }
  return { delivered, failed };
}
