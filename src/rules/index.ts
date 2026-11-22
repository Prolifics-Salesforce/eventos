/**
 * Built-in reactions to domain events. Importing this module subscribes them.
 * A rule changes nothing itself: it calls a tool as the System account, so it
 * gets the same checks and the same audit row as anyone else.
 */
import { eq } from "drizzle-orm";
import { event, registration } from "@/db/schema";
import { agentsEnabled } from "@/agents/model";
import { subscribe } from "@/platform/events";
import { servicePrincipal } from "@/platform/seed";
import { invoke } from "@/platform/tools";
import "@/tools";

const holder = globalThis as unknown as { __eventosRules?: boolean };

if (!holder.__eventosRules) {
  holder.__eventosRules = true;

  /** Confirm every new registration by email, once. */
  subscribe("registration.created", async (db, e) => {
    const { eventId, registrationId, contactId, status } = e.payload as Record<string, string>;
    const waiting = status === "waitlisted";
    const [target] = await db.select().from(event).where(eq(event.id, eventId));
    if (!target) return;
    const [reg] = await db.select({ number: registration.number }).from(registration).where(eq(registration.id, registrationId));
    const base = (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
    const system = await servicePrincipal(db, "System");
    await invoke(db, system, "message.send", {
      contactId, eventId, channel: "email",
      subject: waiting ? `You're on the waitlist for ${target.name}` : `You're registered for ${target.name}`,
      body: [waiting ? `${target.name} is full right now. You are on the waitlist, and we will email you the moment a place opens.` : `Thanks for registering for ${target.name}.`, target.venue ? `Venue: ${target.venue}` : "", `Your registration number is ${reg?.number ?? ""}.`, `Your pass: ${base}/e/${target.slug}/pass/${registrationId}`]
        .filter(Boolean)
        .join("\n"),
      dedupeKey: `registration-confirmation:${registrationId}:${waiting ? "waitlist" : "place"}`,
    });
  });

  /** When agents are on, every captured lead is handed to Lead Intelligence. */
  subscribe("lead.captured", async (db, e) => {
    if (!agentsEnabled()) return;
    const { eventId, leadId } = e.payload as Record<string, string>;
    const system = await servicePrincipal(db, "System");
    await invoke(db, system, "agent.run", { agent: "Lead Intelligence", eventId, goal: `Score lead ${leadId} and draft a follow-up to the contact.` });
  });
}
