/**
 * Things that happen because of the clock rather than because someone acted.
 * Each one is marked in sys_property when done, so it happens exactly once
 * however often the worker looks.
 */
import { and, eq, gt, lte } from "drizzle-orm";
import type { Db } from "@/db/client";
import { event } from "@/db/schema";
import { agentsEnabled } from "@/agents/model";
import { markOnce } from "./properties";
import { servicePrincipal } from "./seed";
import { invoke } from "./tools";
import "@/tools";

export async function runSchedules(db: Db, now = new Date()): Promise<void> {
  const system = await servicePrincipal(db, "System");

  // The day before a live event starts, remind everyone who has not checked in.
  const soon = await db.select().from(event).where(and(eq(event.status, "live"), gt(event.startsAt, now), lte(event.startsAt, new Date(now.getTime() + 24 * 3600_000))));
  for (const e of soon) {
    if (!(await markOnce(db, `reminder-24h:${e.id}`))) continue;
    await invoke(db, system, "campaign.send", {
      eventId: e.id, segment: "not_checked_in", channel: "email", key: "reminder-24h",
      subject: "Tomorrow: {{event_name}}",
      body: ["Hi {{first_name}},", "", `A reminder that {{event_name}} starts soon${e.venue ? ` at ${e.venue}` : ""}.`, "Your pass: {{pass_url}}"].join("\n"),
    });
  }

  // Once a day, ask Analyst for a brief on each live event.
  if (agentsEnabled()) {
    const live = await db.select({ id: event.id }).from(event).where(eq(event.status, "live"));
    for (const e of live) {
      if (!(await markOnce(db, `analyst-brief:${e.id}:${now.toISOString().slice(0, 10)}`))) continue;
      await invoke(db, system, "agent.run", { agent: "Analyst", eventId: e.id, goal: "Write today's brief on how this event is going." });
    }
  }
}
