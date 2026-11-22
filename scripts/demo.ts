/**
 * Fills an empty instance with a realistic sample: two events, guests, sessions,
 * leads, to-dos, an agent run and an approval waiting in the Inbox.
 * For looking around and for screenshots. Run once: npm run db:demo
 */
import { and, eq } from "drizzle-orm";
import { getDb } from "../src/db/client";
import { event, sysUser } from "../src/db/schema";
import { setModel, type Block } from "../src/agents/model";
import { runNextAgentRun } from "../src/agents/runtime";
import { drainEvents } from "../src/platform/events";
import { drainOutbox } from "../src/platform/outbox";
import { loadPrincipal } from "../src/platform/principal";
import { ensurePlatform, servicePrincipal } from "../src/platform/seed";
import { invoke } from "../src/platform/tools";
import "../src/rules";

const db = await getDb();
await ensurePlatform(db);
if ((await db.select().from(event)).length > 0) {
  console.log("This instance already has events; the sample was not added.");
  process.exit(0);
}
const [adminRow] = await db.select().from(sysUser).where(eq(sysUser.kind, "human"));
if (!adminRow) throw new Error("Run npm run db:seed first");
const admin = (await loadPrincipal(db, adminRow.id))!;
const site = await servicePrincipal(db, "Public site");
const agent = async (name: string) => {
  const [row] = await db.select().from(sysUser).where(and(eq(sysUser.name, name), eq(sysUser.kind, "agent")));
  return (await loadPrincipal(db, row.id))!;
};
const run = async <T>(who: typeof admin, tool: string, input: unknown) => {
  const r = await invoke<T>(db, who, tool, input);
  if (r.status !== "ok") throw new Error(`${tool}: ${JSON.stringify(r)}`);
  return r.output;
};
const days = (n: number, hour = 9) => {
  const d = new Date(Date.now() + n * 86_400_000);
  d.setUTCHours(hour - 5, 30, 0, 0);
  return d.toISOString();
};
setModel(null);

const summit = await run<{ id: string; slug: string }>(admin, "event.create", {
  name: "Hyderabad Data Leaders Summit", kind: "conference", venue: "HICC, Hyderabad", startsAt: days(18), endsAt: days(18, 18),
  brief: "A one-day summit for 150 data and analytics leaders from enterprises in South India. Goal: 40 qualified conversations about lakehouse migration.",
});
await run(admin, "event.set_status", { eventId: summit.id, status: "live" });
await run(admin, "event.update", { eventId: summit.id, capacity: 150, targetRegistrations: 150, targetLeads: 40 });
for (const [label, planned, actual] of [["Venue hire, HICC halls A and B", 900000, 900000], ["Catering for 150", 450000, null], ["AV and stage", 300000, 320000], ["Speaker travel", 180000, null]] as const)
  await run(admin, "budget.set_item", { eventId: summit.id, label, planned, actual });
await run(admin, "form.add_field", { eventId: summit.id, purpose: "registration", label: "Company", required: true });
await run(admin, "form.add_field", { eventId: summit.id, purpose: "registration", label: "Meal preference", type: "select", options: ["Vegetarian", "Non-vegetarian", "Vegan"] });
await run(admin, "form.add_field", { eventId: summit.id, purpose: "lead", label: "Timeline", type: "select", options: ["This quarter", "This year", "Exploring"] });

const speakers = [["Meera", "Iyer", "Chief Data Officer"], ["Arjun", "Rao", "VP Engineering"], ["Farah", "Khan", "Head of Analytics"]];
const sessions = [["Opening keynote: the lakehouse decade", "Main stage", "Hall A", 9], ["Migrating 400 pipelines without a freeze", "Engineering", "Hall B", 11], ["Governance that analysts do not hate", "Leadership", "Hall A", 14]] as const;
for (let i = 0; i < sessions.length; i++) {
  const [title, track, room, hour] = sessions[i];
  const s = await run<{ id: string }>(admin, "session.create", { eventId: summit.id, title, track, room, startsAt: days(18, hour) });
  const [firstName, lastName, title2] = speakers[i];
  const c = await run<{ id: string }>(admin, "contact.upsert", { email: `${firstName.toLowerCase()}@speakers.example`, firstName, lastName, title: title2 });
  await run(admin, "session.add_speaker", { sessionId: s.id, contactId: c.id });
}

const guests = [["Priya", "Nair", "Northwind"], ["Sam", "Patel", "Acme"], ["Ravi", "Menon", "Globex"], ["Anita", "Desai", "Initech"], ["Karthik", "Reddy", "Umbrella"],
  ["Sara", "Thomas", "Hooli"], ["Imran", "Sheikh", "Soylent"], ["Divya", "Pillai", "Stark"], ["Rohan", "Gupta", "Wayne"], ["Neha", "Kapoor", "Wonka"], ["Vikram", "Singh", "Tyrell"], ["Lakshmi", "Rao", "Cyberdyne"]];
const meals = ["Vegetarian", "Non-vegetarian", "Vegan"];
for (let i = 0; i < guests.length; i++) {
  const [firstName, lastName, company] = guests[i];
  await run(site, "registration.register_guest", {
    eventSlug: summit.slug, firstName, lastName, email: `${firstName.toLowerCase()}@${company.toLowerCase()}.example`,
    phone: i % 2 ? `+9198765432${10 + i}` : undefined, whatsappOptIn: i % 2 === 1, answers: { company, meal_preference: meals[i % 3] },
  });
}

for (const t of ["Confirm AV and stage crew with HICC", "Send speaker briefing pack", "Print badges and lanyards", "Book photographer"]) await run(admin, "task.create", { eventId: summit.id, shortDescription: t });
await run(admin, "note.add", { table: "event", recordId: summit.id, body: "Venue confirmed Hall A and Hall B. Catering needs final numbers ten days before." });

await run(admin, "guest.import", { eventId: summit.id, rows: [["Aditi", "Shah"], ["Manoj", "Varma"], ["Zoya", "Mirza"], ["Harish", "Iyer"], ["Bela", "Dutta"], ["Kiran", "Joshi"]].map(([firstName, lastName]) => ({ email: `${firstName.toLowerCase()}@invited.example`, firstName, lastName })) });
await run(admin, "campaign.send", { eventId: summit.id, segment: "invited", channel: "email", subject: "You're invited: Hyderabad Data Leaders Summit", body: "Hi {{first_name}},\n\nWe would like to invite you to {{event_name}}.\n\nPlease let us know if you can join us:\n{{rsvp_url}}", key: "invite-1" });

const booth = await run<{ id: string }>(admin, "event.create", { name: "AI Expo Bengaluru booth", kind: "booth", venue: "BIEC, Hall 3, Stand B12", startsAt: days(-1), endsAt: days(1, 18), brief: "Meet platform teams evaluating migration tooling. Target 60 leads, 15 hot." });
await run(admin, "event.set_status", { eventId: booth.id, status: "live" });
await run(admin, "event.update", { eventId: booth.id, targetLeads: 60 });
for (const [label, planned, actual] of [["Stand space, 18 sqm", 600000, 600000], ["Stand build and graphics", 350000, 372000], ["Giveaways", 80000, 64000]] as const)
  await run(admin, "budget.set_item", { eventId: booth.id, label, planned, actual });
await run(admin, "event.create", { name: "Chennai CXO dinner", kind: "field", venue: "Taj Coromandel", startsAt: days(41, 19) });

const leads = [["Nikhil", "Bose", "Head of Platform", "Wants a demo of the lakehouse migration next week. Budget approved for Q1.", 88, "Senior platform owner, budget approved, asked for a demo next week."],
  ["Tara", "Joseph", "Data Engineer", "Curious about pricing, no project yet.", 35, "Individual contributor with no active project."],
  ["Omar", "Farooq", "VP Data", "Running a bake-off against two vendors in January. Asked for a reference customer.", 76, "Decision maker in an active evaluation with a set date."],
  ["Jaya", "Krishnan", "Analytics Manager", "Team of 12, interested in governance features.", 55, "Has a team and a need, but no timeline was mentioned."]] as const;
const scorer = await agent("Lead Intelligence");
for (const [firstName, lastName, title, notes, score, reason] of leads) {
  const c = await run<{ id: string }>(admin, "contact.upsert", { email: `${firstName.toLowerCase()}@prospects.example`, firstName, lastName, title });
  const l = await run<{ id: string }>(admin, "lead.capture", { eventId: booth.id, contactId: c.id, notes });
  if (score !== 35) await run(scorer, "lead.score", { leadId: l.id, score, reason });
  if (score >= 76) await run(admin, "lead.set_value", { leadId: l.id, pipelineValue: score === 88 ? 4500000 : 2800000 });
  if (score === 88) {
    // The agent drafts a follow-up; because it leaves the organisation, it waits in the Inbox.
    await invoke(db, scorer, "message.send", {
      contactId: c.id, eventId: booth.id, channel: "email", subject: "Your lakehouse migration demo",
      body: `Hi ${firstName},\n\nGood to meet you at our stand at AI Expo. You mentioned wanting to see the lakehouse migration in action next week, with budget in place for Q1.\n\nWould Tuesday or Wednesday afternoon suit for a 30-minute demo with our solutions lead?\n\nBest,\nThe events team`,
    });
  }
}
const boothGuests = await db.query.registration.findMany({ where: (r, { and, eq }) => and(eq(r.eventId, summit.id), eq(r.status, "registered")), limit: 5 });
for (const g of boothGuests) await run(admin, "registration.check_in", { registrationId: g.id });
for (const [i, score] of [10, 9, 8, 9].entries()) await run(site, "survey.submit", { registrationId: boothGuests[i].id, score, comment: i === 0 ? "The migration session was exactly what my team needed." : i === 2 ? "Good content. The lunch queue was long." : undefined });

// One recorded agent run, so the Agent runs screen has something to show.
const outreach = await agent("Outreach");
const turns: Block[][] = [
  [{ type: "text", text: "Reading the event and its numbers before planning." }, { type: "tool_use", id: "1", name: "event-get", input: { eventId: summit.id } }],
  [{ type: "tool_use", id: "2", name: "task-create", input: { eventId: summit.id, shortDescription: "Decide the registration target per track", description: "The brief asks for 150 attendees but does not split them by track. A person should set this." } },
   { type: "tool_use", id: "3", name: "note-add", input: { table: "event", recordId: summit.id, body: "Plan from the brief: 12 of 150 places are filled with 18 days to go. Three sessions are scheduled. Next: speaker briefing, a second invitation wave, and badge printing ten days out." } },
   { type: "tool_use", id: "4", name: "event-set_status", input: { eventId: summit.id, status: "closed" } }],
  [{ type: "text", text: "I recorded a plan on the event and added a to-do for the one decision the brief leaves open. I also proposed closing registration, which is waiting for your approval; reject it if you want registration to stay open." }],
];
setModel(async () => { const content = turns.shift() ?? [{ type: "text", text: "Done." }]; return { content, stopReason: content.some((b) => b.type === "tool_use") ? "tool_use" : "end_turn" }; });
await run(admin, "agent.run", { agent: "Builder", eventId: summit.id, goal: "Plan this event from the brief and tell me what is missing." });
await runNextAgentRun(db);
setModel(null);
await invoke(db, outreach, "campaign.send", { eventId: summit.id, segment: "not_checked_in", channel: "email", subject: "Your agenda for {{event_name}}", body: "Hi {{first_name}},\n\nThe agenda is now final: three sessions across two halls, starting at 9:00.\n\nYour pass: {{pass_url}}" });

await drainEvents(db, 500);
await drainEvents(db, 500);
await drainOutbox(db, 500);
console.log("Sample data added: 3 events, 18 guests, 4 leads, budgets, survey answers, an agent run and 3 approvals in the Inbox.");
process.exit(0);
