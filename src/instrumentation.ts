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

/**
 * Every error a page, action or route lets through, as one line of JSON in the
 * server log, so a log service can count and alert on them.
 */
export function onRequestError(error: unknown, request: { path: string; method: string }, context: { routePath: string; routeType: string }) {
  const e = error as { message?: string; digest?: string; stack?: string };
  console.error(JSON.stringify({
    level: "error", at: new Date().toISOString(), method: request.method, path: request.path.split("?")[0],
    route: context.routePath, kind: context.routeType, message: e?.message ?? String(error), digest: e?.digest, stack: e?.stack?.split("\n").slice(0, 6).join(" | "),
  }));
}
