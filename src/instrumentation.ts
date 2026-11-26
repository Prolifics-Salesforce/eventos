/** Runs once when the server starts: platform accounts, rules, mail driver, background worker. */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { getDb } = await import("@/db/client");
  const { ensurePlatform } = await import("@/platform/seed");
  const { startWorker } = await import("@/platform/worker");
  const { wire } = await import("@/platform/wiring");
  // On Vercel there is no long-running process: the build step sets the platform up
  // (scripts/migrate.ts) and a scheduler drives the work through /api/cron/tick.
  const serverless = Boolean(process.env.VERCEL);
  if (!serverless) await ensurePlatform(await getDb());
  await wire();
  if (serverless) return;

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
