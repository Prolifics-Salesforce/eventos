/** Runs once when the server starts: platform accounts, rules, mail driver, background worker. */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { getDb } = await import("@/db/client");
  const { ensurePlatform } = await import("@/platform/seed");
  const { startWorker } = await import("@/platform/worker");
  await ensurePlatform(await getDb());
  await import("@/rules");
  const { registerWebhooks, webhookDriver } = await import("@/platform/webhooks");
  const { setDriver: setChannelDriver } = await import("@/platform/outbox");
  registerWebhooks();
  setChannelDriver("webhook", webhookDriver(getDb));

  if (process.env.SMTP_URL) {
    const { smtpDriver } = await import("@/platform/mail");
    const { setDriver } = await import("@/platform/outbox");
    setDriver("email", await smtpDriver(process.env.SMTP_URL, process.env.MAIL_FROM ?? "EventOS <no-reply@localhost>"));
  }

  const { runNextAgentRun } = await import("@/agents/runtime");
  const { runSchedules } = await import("@/platform/schedules");
  let lastSchedule = 0;
  startWorker(getDb, async (db) => {
    if (Date.now() - lastSchedule > 60_000) {
      lastSchedule = Date.now();
      await runSchedules(db);
    }
    await runNextAgentRun(db);
  });
}
