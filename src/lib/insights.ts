import { eq, inArray } from "drizzle-orm";
import type { Db } from "@/db/client";
import { budgetItem, event, lead, registration, surveyResponse } from "@/db/schema";

type EventRow = typeof event.$inferSelect;
type Reg = { status: string; checkedInAt: Date | null };
type LeadRow = { band: string | null; value: number | null };
type Budget = { planned: number; actual: number | null };
type Survey = { score: number };

export type Insights = ReturnType<typeof summarise>;

/** The sums behind "what did this event cost and what did it produce?", from rows already read. */
function summarise(e: EventRow | undefined, regs: Reg[], leads: LeadRow[], budget: Budget[], surveys: Survey[]) {
  const n = (s: string) => regs.filter((r) => r.status === s).length;
  const attended = regs.filter((r) => r.checkedInAt).length;
  const registered = n("registered") + attended;
  const invited = regs.length; // everyone who was ever on the list
  const planned = budget.reduce((t, b) => t + b.planned, 0);
  const actual = budget.reduce((t, b) => t + (b.actual ?? 0), 0);
  const hasActuals = budget.some((b) => b.actual != null);
  const cost = hasActuals ? actual : planned;
  const pipeline = leads.reduce((t, l) => t + (l.value ?? 0), 0);
  const per = (a: number, b: number) => (a > 0 && b > 0 ? Math.round(a / b) : null);
  const promoters = surveys.filter((s) => s.score >= 9).length;
  const detractors = surveys.filter((s) => s.score <= 6).length;
  return {
    currency: e?.currency ?? "INR",
    funnel: { onList: invited, awaitingReply: n("invited"), registered, attended, waitlisted: n("waitlisted"), declined: n("declined"), cancelled: n("cancelled") },
    showRate: registered ? Math.round((attended / registered) * 100) : null,
    leads: { total: leads.length, hot: leads.filter((l) => l.band === "hot").length, warm: leads.filter((l) => l.band === "warm").length },
    targets: { registrations: e?.targetRegistrations ?? null, leads: e?.targetLeads ?? null, capacity: e?.capacity ?? null },
    money: {
      planned, actual: hasActuals ? actual : null, pipeline,
      costPerAttendee: per(cost, attended), costPerLead: per(cost, leads.length),
      /** Pipeline created for each unit of currency spent. Null until there is both a cost and a pipeline figure. */
      pipelinePerUnitSpent: cost > 0 && pipeline > 0 ? Math.round((pipeline / cost) * 10) / 10 : null,
    },
    nps: surveys.length ? { score: Math.round(((promoters - detractors) / surveys.length) * 100), responses: surveys.length } : null,
  };
}

/** Everything needed to answer "what did this event cost and what did it produce?" Pass the event when it is already in hand. */
export async function eventInsights(db: Db, eventId: string, known?: EventRow) {
  const [[e], regs, leads, budget, surveys] = await Promise.all([
    known ? [known] : db.select().from(event).where(eq(event.id, eventId)),
    db.select({ status: registration.status, checkedInAt: registration.checkedInAt }).from(registration).where(eq(registration.eventId, eventId)),
    db.select({ band: lead.band, value: lead.pipelineValue }).from(lead).where(eq(lead.eventId, eventId)),
    db.select({ planned: budgetItem.planned, actual: budgetItem.actual }).from(budgetItem).where(eq(budgetItem.eventId, eventId)),
    db.select({ score: surveyResponse.score }).from(surveyResponse).where(eq(surveyResponse.eventId, eventId)),
  ]);
  return summarise(e, regs, leads, budget, surveys);
}

/** The same figures for many events at once: four queries in all, however many events there are. */
export async function insightsFor(db: Db, events: EventRow[]): Promise<Map<string, Insights>> {
  const ids = events.map((e) => e.id);
  if (ids.length === 0) return new Map();
  const [regs, leads, budget, surveys] = await Promise.all([
    db.select({ eventId: registration.eventId, status: registration.status, checkedInAt: registration.checkedInAt }).from(registration).where(inArray(registration.eventId, ids)),
    db.select({ eventId: lead.eventId, band: lead.band, value: lead.pipelineValue }).from(lead).where(inArray(lead.eventId, ids)),
    db.select({ eventId: budgetItem.eventId, planned: budgetItem.planned, actual: budgetItem.actual }).from(budgetItem).where(inArray(budgetItem.eventId, ids)),
    db.select({ eventId: surveyResponse.eventId, score: surveyResponse.score }).from(surveyResponse).where(inArray(surveyResponse.eventId, ids)),
  ]);
  const of = <T extends { eventId: string }>(rows: T[], id: string) => rows.filter((r) => r.eventId === id);
  return new Map(events.map((e) => [e.id, summarise(e, of(regs, e.id), of(leads, e.id), of(budget, e.id), of(surveys, e.id))]));
}

export const money = (amount: number | null | undefined, currency = "INR") =>
  amount == null ? "–" : new Intl.NumberFormat("en-IN", { style: "currency", currency, maximumFractionDigits: 0 }).format(amount);
