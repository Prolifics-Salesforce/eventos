/**
 * Connects the pieces that react to events and deliver messages: the built-in
 * rules, the webhook connections and the email driver. Whatever is about to
 * deliver events or send messages calls this first; it does its work once per process.
 */
import { getDb } from "@/db/client";
import { setDriver } from "./outbox";
import { registerWebhooks, webhookDriver } from "./webhooks";

const holder = globalThis as unknown as { __eventosWired?: Promise<void> };

export function wire(): Promise<void> {
  return (holder.__eventosWired ??= (async () => {
    await import("@/rules");
    registerWebhooks();
    setDriver("webhook", webhookDriver(getDb));
    if (process.env.SMTP_URL) {
      const { smtpDriver } = await import("./mail");
      setDriver("email", await smtpDriver(process.env.SMTP_URL, process.env.MAIL_FROM ?? "EventOS <no-reply@localhost>"));
    }
  })());
}
