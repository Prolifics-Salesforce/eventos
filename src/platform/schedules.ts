/**
 * Things that happen because of the clock rather than because someone acted.
 * Each one is marked in sys_property when done, so it happens exactly once
 * however often the worker looks.
 */
import { and, eq, gt, inArray, isNotNull, lte, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { event } from "@/db/schema";
import { agentsEnabled } from "@/agents/model";
import { markOnce } from "./properties";
import { servicePrincipal } from "./seed";
import { invoke } from "./tools";
import "@/tools";

const HOUR = 3600_000;

export async function runSchedules(db: Db, now = new Date()): Promise<void> {
  const system = await servicePrincipal(db, "System");
  const at = (ms: number) => new Date(now.getTime() + ms);

  // A day before, and again an hour before, a live event starts: remind everyone holding a place who has not checked in.
  const soon = await db.select().from(event).where(and(eq(event.status, "live"), eq(event.reminders, true), gt(event.startsAt, now), lte(event.startsAt, at(24 * HOUR))));
  for (const e of soon) {
    const where = e.venue ? ` at ${e.venue}` : "";
    const withinTheHour = e.startsAt!.getTime() - now.getTime() <= HOUR;
    if (await markOnce(db, `reminder-24h:${e.id}`)) {
      // Switched on, or taken live, with less than an hour to go: the hour-before reminder below says it all.
      if (!withinTheHour) await invoke(db, system, "campaign.send", {
        eventId: e.id, segment: "not_checked_in", channel: "email", key: "reminder-24h",
        subject: "Tomorrow: {{event_name}}",
        body: ["Hi {{first_name}},", "", `A reminder that {{event_name}} starts soon${where}.`, "Your pass: {{pass_url}}"].join("\n"),
      });
    }
    if (withinTheHour && (await markOnce(db, `reminder-1h:${e.id}`))) {
      await invoke(db, system, "campaign.send", {
        eventId: e.id, segment: "not_checked_in", channel: "email", key: "reminder-1h",
        subject: "Starting soon: {{event_name}}",
        body: ["Hi {{first_name}},", "", `{{event_name}} starts within the hour${where}.`, "Have your pass ready at the door: {{pass_url}}"].join("\n"),
      });
    }
  }

  // An hour after an event ends (or, with no end time, three hours after it starts), ask everyone who came how it was.
  // Not sent for an event that finished more than a week ago: switching it on late should not surprise old guests.
  const finishedAt = sql`coalesce(${event.endsAt}, ${event.startsAt} + interval '2 hours')`;
  const finished = await db.select().from(event).where(and(
    inArray(event.status, ["live", "closed"]), eq(event.feedbackEmail, true), isNotNull(event.startsAt),
    lte(finishedAt, at(-HOUR)), gt(finishedAt, at(-7 * 24 * HOUR)),
  ));
  for (const e of finished) {
    if (!(await markOnce(db, `feedback:${e.id}`))) continue;
    await invoke(db, system, "campaign.send", {
      eventId: e.id, segment: "checked_in", channel: "email", key: "feedback",
      subject: "How was {{event_name}}?",
      body: ["Hi {{first_name}},", "", "Thank you for coming to {{event_name}}.", "It takes a few seconds to tell us how it was:", "{{pass_url}}"].join("\n"),
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
