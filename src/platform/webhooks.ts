import { createHmac } from "node:crypto";
import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { webhook } from "@/db/schema";
import { subscribe } from "./events";
import { enqueue, type Driver } from "./outbox";

const holder = globalThis as unknown as { __eventosWebhooks?: boolean };

/** Queue a delivery for every connection that asked for this kind of event. Runs inside the event's transaction. */
export function registerWebhooks(): void {
  if (holder.__eventosWebhooks) return;
  holder.__eventosWebhooks = true;
  subscribe("*", async (db, e) => {
    const hooks = await db.select().from(webhook).where(eq(webhook.active, true));
    for (const hook of hooks) {
      if (!hook.events.includes("*") && !hook.events.includes(e.name)) continue;
      await enqueue(db, {
        channel: "webhook", recipient: hook.url, subject: e.name,
        body: JSON.stringify({ id: e.id, event: e.name, at: e.at, data: e.payload }),
        meta: { webhookId: hook.id }, dedupeKey: `webhook:${hook.id}:${e.id}`,
      });
    }
  });
}

/** `sha256=<hex>` over "<timestamp>.<body>", so a receiver can reject forgeries and replays. */
export const sign = (secret: string, timestamp: string, body: string) => `sha256=${createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex")}`;

export function webhookDriver(getDb: () => Promise<Db>): Driver {
  return async (message) => {
    const db = await getDb();
    const [hook] = await db.select().from(webhook).where(eq(webhook.id, String(message.meta.webhookId)));
    if (!hook || !hook.active) return; // removed since it was queued: nothing to send
    const timestamp = String(Math.floor(Date.now() / 1000));
    const response = await fetch(hook.url, {
      method: "POST", redirect: "error", signal: AbortSignal.timeout(10_000),
      headers: { "content-type": "application/json", "x-eventos-event": message.subject ?? "", "x-eventos-timestamp": timestamp, "x-eventos-signature": sign(hook.secret, timestamp, message.body) },
      body: message.body,
    });
    if (!response.ok) throw new Error(`The receiver answered ${response.status}`);
  };
}
