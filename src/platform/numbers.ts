import { sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { sysNumber } from "@/db/schema";

/** Next human-readable number for a prefix, e.g. EVT0000001. Safe under concurrency. */
export async function nextNumber(db: Db, prefix: string): Promise<string> {
  const [row] = await db
    .insert(sysNumber)
    .values({ prefix, next: 2 })
    .onConflictDoUpdate({ target: sysNumber.prefix, set: { next: sql`${sysNumber.next} + 1` } })
    .returning({ next: sysNumber.next });
  return `${prefix}${String(row.next - 1).padStart(7, "0")}`;
}
