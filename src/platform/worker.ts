import type { Db } from "@/db/client";
import { drainEvents } from "./events";
import { drainOutbox } from "./outbox";

const holder = globalThis as unknown as { __eventosWorker?: NodeJS.Timeout };

/**
 * Deliver events and send queued messages every few seconds, in this process.
 * Right for one instance on one server. When an instance needs several web
 * processes, run this in a single separate worker instead.
 */
export function startWorker(getDb: () => Promise<Db>, extra: (db: Db) => Promise<unknown> = async () => {}, everyMs = 3000): void {
  if (holder.__eventosWorker) return;
  let busy = false;
  holder.__eventosWorker = setInterval(async () => {
    if (busy) return;
    busy = true;
    try {
      const db = await getDb();
      await drainEvents(db);
      await drainOutbox(db);
      await extra(db);
    } catch (error) {
      console.error("[worker]", error);
    } finally {
      busy = false;
    }
  }, everyMs);
  holder.__eventosWorker.unref?.();
}
