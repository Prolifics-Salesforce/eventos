/**
 * One pass of the background work, for hosts with no long-running process
 * (serverless). A scheduler calls it every minute through /api/cron/tick.
 * On one server the in-process worker in worker.ts does the same job.
 */
import { and, eq, lt, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { task } from "@/db/schema";
import { runNextAgentRun } from "@/agents/runtime";
import { drainEvents } from "./events";
import { acquireLease, releaseLease, sweepLimits } from "./limits";
import { drainOutbox } from "./outbox";
import { runSchedules } from "./schedules";

const LEASE = "tick";
/** Longer than the route may run, so a pass that is killed frees the lease soon after. */
const LEASE_MS = 330_000;
const STALE_RUN_MS = 15 * 60_000;

export type TickResult = { skipped: true } | { skipped: false; events: number; sent: number; failed: number; runs: number; ms: number };

/** An agent run whose process was stopped part-way would stay "in progress" for ever. Close it as failed. */
async function failStaleRuns(db: Db, now: Date): Promise<void> {
  await db
    .update(task)
    .set({ state: "failed", closedAt: now, updatedAt: now, payload: sql`${task.payload} || '{"error":"The run was interrupted before it finished"}'::jsonb` })
    .where(and(eq(task.taskType, "agent_run"), eq(task.state, "in_progress"), lt(task.updatedAt, new Date(now.getTime() - STALE_RUN_MS))));
}

/**
 * Deliver events, send queued messages, run what the clock asks for and carry
 * out queued agent runs, until there is nothing left or `budgetMs` is used up.
 * Agent runs are only started in the first half of the budget, since one can take minutes.
 */
export async function tick(db: Db, budgetMs = 240_000): Promise<TickResult> {
  const lease = await acquireLease(db, LEASE, LEASE_MS);
  if (!lease) return { skipped: true };
  const started = Date.now();
  const left = () => budgetMs - (Date.now() - started);
  let events = 0, sent = 0, failed = 0, runs = 0;
  /** Events queue messages, so deliver events first, then send until the queue is empty. */
  const deliver = async () => {
    events += (await drainEvents(db)).delivered;
    while (left() > 0) {
      const batch = await drainOutbox(db);
      sent += batch.sent;
      failed += batch.failed;
      if (batch.sent + batch.failed === 0) break;
    }
  };
  try {
    await failStaleRuns(db, new Date());
    await deliver();
    await runSchedules(db);
    while (left() > budgetMs / 2 && (await runNextAgentRun(db))) runs++;
    await deliver();
    await sweepLimits(db);
    return { skipped: false, events, sent, failed, runs, ms: Date.now() - started };
  } finally {
    await releaseLease(db, LEASE, lease);
  }
}
