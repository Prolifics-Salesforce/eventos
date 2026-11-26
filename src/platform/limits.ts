/**
 * Counters and leases kept in the database, so every web process sees the same
 * numbers. They live in sys_property under the `limit:` and `lease:` prefixes,
 * each as a small JSON value with the time it stops counting.
 */
import { and, eq, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { sysProperty } from "@/db/schema";

type Window = { count: number; until: number };

/** How many times `key` has been hit in its current window. 0 when the window is over. */
export async function limitCount(db: Db, key: string, now = Date.now()): Promise<number> {
  const [row] = await db.select({ value: sysProperty.value }).from(sysProperty).where(eq(sysProperty.key, `limit:${key}`));
  if (!row) return 0;
  const window = JSON.parse(row.value) as Window;
  return window.until > now ? window.count : 0;
}

/** Count one more hit on `key`, starting a new window when the last one is over. Returns the count so far. */
export async function limitHit(db: Db, key: string, windowMs: number, now = Date.now()): Promise<number> {
  const fresh = JSON.stringify({ count: 1, until: now + windowMs } satisfies Window);
  const stored = sql`${sysProperty.value}::jsonb`;
  const [row] = await db
    .insert(sysProperty)
    .values({ key: `limit:${key}`, value: fresh })
    .onConflictDoUpdate({
      target: sysProperty.key,
      // One statement, so two processes counting at once cannot lose a hit.
      set: { value: sql`case when (${stored}->>'until')::bigint > ${now} then jsonb_set(${stored}, '{count}', to_jsonb((${stored}->>'count')::int + 1))::text else ${fresh} end` },
    })
    .returning({ value: sysProperty.value });
  return (JSON.parse(row.value) as Window).count;
}

export async function limitClear(db: Db, key: string): Promise<void> {
  await db.delete(sysProperty).where(eq(sysProperty.key, `limit:${key}`));
}

/** Remove counters whose window is over. Other properties are never touched. */
export async function sweepLimits(db: Db, now = Date.now()): Promise<void> {
  await db.delete(sysProperty).where(sql`case when ${sysProperty.key} like 'limit:%' then (${sysProperty.value}::jsonb->>'until')::bigint < ${now} else false end`);
}

/**
 * Take a lease so only one process does a job at a time. Returns a token to
 * release it with, or null when another process holds it. A holder that dies
 * loses the lease after `ttlMs`.
 */
export async function acquireLease(db: Db, name: string, ttlMs: number, now = Date.now()): Promise<string | null> {
  const value = JSON.stringify({ until: now + ttlMs, nonce: Math.random().toString(36).slice(2) });
  const rows = await db
    .insert(sysProperty)
    .values({ key: `lease:${name}`, value })
    .onConflictDoUpdate({ target: sysProperty.key, set: { value }, setWhere: sql`(${sysProperty.value}::jsonb->>'until')::bigint < ${now}` })
    .returning({ key: sysProperty.key });
  return rows.length === 1 ? value : null;
}

export async function releaseLease(db: Db, name: string, token: string): Promise<void> {
  await db.delete(sysProperty).where(and(eq(sysProperty.key, `lease:${name}`), eq(sysProperty.value, token)));
}
