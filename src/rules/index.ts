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
      body: [waiting ? `${target.name} is full right now. You are on the waitlist, and we will email you the moment a place opens.` : `Thanks for registering for ${target.name}.`, target.venue ? `Venue: ${target.venue}` : "", !waiting && target.confirmationNote ? `\n${target.confirmationNote}\n` : "", `Your registration number is ${reg?.number ?? ""}.`, `Your pass: ${base}/e/${target.slug}/pass/${registrationId}`, !waiting && target.startsAt ? `Add it to your calendar: ${base}/e/${target.slug}/calendar.ics` : ""]
        .filter(Boolean)
        .join("\n"),
      dedupeKey: `registration-confirmation:${registrationId}:${waiting ? "waitlist" : "place"}`,
    });
  });

  /** A guest who asked to join an event that approves each guest hears that the request arrived, and later if it was turned down. */
  const tellGuest = (kind: "requested" | "turned_down") => async (db: Parameters<Parameters<typeof subscribe>[1]>[0], e: Parameters<Parameters<typeof subscribe>[1]>[1]) => {
    const { eventId, registrationId, contactId } = e.payload as Record<string, string>;
    const [target] = await db.select().from(event).where(eq(event.id, eventId));
    if (!target) return;
    const base = (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
    const system = await servicePrincipal(db, "System");
    await invoke(db, system, "message.send", {
      contactId, eventId, channel: "email",
      subject: kind === "requested" ? `We have your request for ${target.name}` : `About your request for ${target.name}`,
      body: kind === "requested"
        ? [`Thanks for asking to join ${target.name}.`, "The organisers approve each guest. We will email you as soon as they have decided.", `Your request: ${base}/e/${target.slug}/pass/${registrationId}`].join("\n")
        : [`Thank you for your interest in ${target.name}.`, "We are sorry that we cannot offer you a place this time."].join("\n"),
      dedupeKey: `registration-${kind}:${registrationId}:${e.id}`,
    });
  };
  subscribe("registration.requested", tellGuest("requested"));
  subscribe("registration.turned_down", tellGuest("turned_down"));

  /** When agents are on, every captured lead is handed to Lead Intelligence. */
  subscribe("lead.captured", async (db, e) => {
    if (!agentsEnabled()) return;
    const { eventId, leadId } = e.payload as Record<string, string>;
    const system = await servicePrincipal(db, "System");
    await invoke(db, system, "agent.run", { agent: "Lead Intelligence", eventId, goal: `Score lead ${leadId} and draft a follow-up to the contact.` });
  });
}
