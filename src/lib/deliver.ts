import { after } from "next/server";
import { getDb } from "@/db/client";
import { drainEvents } from "@/platform/events";
import { drainOutbox } from "@/platform/outbox";
import { wire } from "@/platform/wiring";

/**
 * On a serverless host the background work waits for the next scheduled pass,
 * up to a minute away. Call this from an action that may have queued something:
 * once the reply has gone out, the same process delivers the events and sends
 * the messages, so a confirmation email leaves within seconds. Anything it
 * does not reach is picked up by the scheduled pass. Elsewhere the in-process
 * worker is already doing this every few seconds.
 */
export function deliverSoon(): void {
  if (!process.env.VERCEL) return;
  after(async () => {
    try {
      await wire();
      const db = await getDb();
      await drainEvents(db);
      await drainOutbox(db);
    } catch (error) {
      console.error("[deliver]", error);
    }
  });
}
