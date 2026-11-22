import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { budgetItem, event, lead, registration, surveyResponse } from "@/db/schema";

export type Insights = Awaited<ReturnType<typeof eventInsights>>;

/** Everything needed to answer "what did this event cost and what did it produce?" */
export async function eventInsights(db: Db, eventId: string) {
  const [e] = await db.select().from(event).where(eq(event.id, eventId));
  const [regs, leads, budget, surveys] = await Promise.all([
    db.select({ status: registration.status, checkedInAt: registration.checkedInAt }).from(registration).where(eq(registration.eventId, eventId)),
    db.select({ band: lead.band, value: lead.pipelineValue }).from(lead).where(eq(lead.eventId, eventId)),
    db.select().from(budgetItem).where(eq(budgetItem.eventId, eventId)),
    db.select({ score: surveyResponse.score }).from(surveyResponse).where(eq(surveyResponse.eventId, eventId)),
  ]);
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

export const money = (amount: number | null | undefined, currency = "INR") =>
  amount == null ? "–" : new Intl.NumberFormat("en-IN", { style: "currency", currency, maximumFractionDigits: 0 }).format(amount);
