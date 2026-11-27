/**
 * A person's rights over their own data: a copy of everything held about them,
 * and removal of all of it. Both are for administrators, and both are audited
 * without the person's details reaching the ledger.
 */
import { and, eq, inArray, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/db/client";
import { contact, event, lead, registration, surveyResponse, sysAudit, sysJournal, sysOutbox } from "@/db/schema";
import { defineTool, ToolError } from "@/platform/tools";

const email = z.string().trim().toLowerCase().pipe(z.email());

async function find(db: Db, address: string) {
  const [person] = await db.select().from(contact).where(eq(contact.email, address));
  if (!person) throw new ToolError("not_found", "Nobody with that email is on record");
  const [registrations, leads] = await Promise.all([
    db.select({ r: registration, eventName: event.name }).from(registration).innerJoin(event, eq(event.id, registration.eventId)).where(eq(registration.contactId, person.id)),
    db.select({ l: lead, eventName: event.name }).from(lead).innerJoin(event, eq(event.id, lead.eventId)).where(eq(lead.contactId, person.id)),
  ]);
  return { person, registrations, leads };
}

/** Notes written on the person, their registrations or their leads. */
function notesAbout(personId: string, registrationIds: string[], leadIds: string[]): SQL {
  return or(
    and(eq(sysJournal.tableName, "contact"), eq(sysJournal.recordId, personId)),
    registrationIds.length ? and(eq(sysJournal.tableName, "registration"), inArray(sysJournal.recordId, registrationIds)) : undefined,
    leadIds.length ? and(eq(sysJournal.tableName, "lead"), inArray(sysJournal.recordId, leadIds)) : undefined,
  )!;
}

export const contactExport = defineTool({
  name: "contact.export",
  description: "Everything held about one person, found by email: their details, registrations, leads, survey answers, messages sent to them and notes about them.",
  permission: "admin.manage",
  risk: "read",
  // The ledger records that an export happened and who asked, never the person or the data.
  redact: ["email", "contact", "registrations", "leads", "surveys", "messages", "notes"],
  input: z.object({ email }),
  async handler(ctx, input) {
    const { person, registrations, leads } = await find(ctx.db, input.email);
    const registrationIds = registrations.map((x) => x.r.id);
    const leadIds = leads.map((x) => x.l.id);
    const [surveys, messages, notes] = await Promise.all([
      registrationIds.length ? ctx.db.select().from(surveyResponse).where(inArray(surveyResponse.registrationId, registrationIds)) : [],
      ctx.db.select().from(sysOutbox).where(eq(sysOutbox.contactId, person.id)),
      ctx.db.select().from(sysJournal).where(notesAbout(person.id, registrationIds, leadIds)),
    ]);
    return {
      exportedAt: new Date().toISOString(),
      contact: {
        firstName: person.firstName, lastName: person.lastName, email: person.email, phone: person.phone, title: person.title,
        emailOptOutAt: person.emailOptOutAt, whatsappOptInAt: person.whatsappOptInAt, createdAt: person.createdAt, custom: person.custom,
      },
      registrations: registrations.map(({ r, eventName }) => ({ event: eventName, number: r.number, status: r.status, source: r.source, registeredAt: r.createdAt, checkedInAt: r.checkedInAt, answers: r.custom })),
      leads: leads.map(({ l, eventName }) => ({ event: eventName, number: l.number, capturedAt: l.createdAt, notes: l.notes, answers: l.answers, score: l.score, band: l.band, pipelineValue: l.pipelineValue })),
      surveys: surveys.map((s) => ({ score: s.score, comment: s.comment, answeredAt: s.createdAt })),
      messages: messages.map((m) => ({ channel: m.channel, recipient: m.recipient, subject: m.subject, body: m.body, status: m.status, queuedAt: m.createdAt, sentAt: m.sentAt })),
      notes: notes.map((n) => ({ about: n.tableName, body: n.body, at: n.at })),
    };
  },
});

const like = (needle: string) => `%${needle.replace(/[%_\\]/g, "\\$&")}%`;

export const contactErase = defineTool({
  name: "contact.erase",
  description: "Remove one person, found by email, and everything held about them: registrations, leads, survey answers, messages, notes, and their details in the ledger. This cannot be undone.",
  permission: "admin.manage",
  risk: "destructive",
  redact: ["email"],
  input: z.object({ email, confirm: z.literal(true).describe("Must be true: the removal is permanent") }),
  async handler(ctx, input) {
    const { person, registrations, leads } = await find(ctx.db, input.email);
    const registrationIds = registrations.map((x) => x.r.id);
    const leadIds = leads.map((x) => x.l.id);

    if (registrationIds.length) await ctx.db.delete(surveyResponse).where(inArray(surveyResponse.registrationId, registrationIds));
    await ctx.db.delete(sysJournal).where(notesAbout(person.id, registrationIds, leadIds));
    const recipients = [person.email, ...(person.phone ? [person.phone] : [])];
    const messages = await ctx.db.delete(sysOutbox).where(or(eq(sysOutbox.contactId, person.id), inArray(sysOutbox.recipient, recipients))).returning({ id: sysOutbox.id });

    // The ledger keeps the fact that something was done and by whom, but loses what it said about this person.
    const needles = [person.email, person.id, ...registrationIds, ...leadIds];
    const mentions = or(...needles.flatMap((n) => [sql`${sysAudit.input}::text ilike ${like(n)}`, sql`${sysAudit.result}::text ilike ${like(n)}`, sql`${sysAudit.error} ilike ${like(n)}`]));
    const ledger = await ctx.db.update(sysAudit).set({ input: { erased: true }, result: null, error: null }).where(mentions).returning({ id: sysAudit.id });

    // Registrations, leads and speaker slots go with the contact.
    await ctx.db.delete(contact).where(eq(contact.id, person.id));
    await ctx.emit("contact.erased", {});
    return { erased: true, registrations: registrationIds.length, leads: leadIds.length, messages: messages.length, ledgerEntries: ledger.length };
  },
});
