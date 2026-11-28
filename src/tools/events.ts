import { and, count, eq, inArray, ne, notInArray } from "drizzle-orm";
import { z } from "zod";
import { contact, event, eventSession, formField, lead, registration, sessionSpeaker, task } from "@/db/schema";
import type { Db } from "@/db/client";
import { budgetItem } from "@/db/schema";
import { eventInsights } from "@/lib/insights";
import { DEFAULT_CURRENCY, DEFAULT_TIMEZONE, isCurrency, isTimeZone } from "@/lib/when";
import { nextNumber } from "@/platform/numbers";
import { defineTool, ToolError } from "@/platform/tools";
import { withUnsubscribe } from "./messages";

const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
const when = z.iso.datetime({ offset: true }).optional().describe("ISO 8601 with offset, e.g. 2027-02-12T09:00:00+05:30");
const toDate = (s?: string | null) => (s ? new Date(s) : null);
const link = z.url().max(500).refine((u) => u.startsWith("https://"), "Use an https address");
const slugText = z.string().trim().toLowerCase().min(3).max(60).regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "Use lower-case letters, numbers and single hyphens");
const zone = z.string().max(64).refine(isTimeZone, "Use a time zone name such as Asia/Kolkata or Europe/London");
const currencyCode = z.string().trim().toUpperCase().refine(isCurrency, "Use a three-letter currency code such as INR, USD or EUR");

export const eventCreate = defineTool({
  name: "event.create",
  description: "Create a draft event. Kind is booth, field (field-marketing) or conference.",
  permission: "event.write",
  risk: "write",
  input: z.object({
    name: z.string().min(2).max(120),
    kind: z.enum(["booth", "field", "conference"]),
    startsAt: when, endsAt: when,
    timezone: zone.default(DEFAULT_TIMEZONE),
    currency: currencyCode.default(DEFAULT_CURRENCY),
    venue: z.string().max(200).optional(),
    brief: z.string().max(4000).optional().describe("The organiser's goal in their own words"),
  }),
  async handler(ctx, input) {
    const number = await nextNumber(ctx.db, "EVT");
    const [row] = await ctx.db
      .insert(event)
      .values({
        number, name: input.name, kind: input.kind, timezone: input.timezone, currency: input.currency, venue: input.venue, brief: input.brief,
        slug: `${slugify(input.name)}-${number.slice(-4)}`,
        startsAt: toDate(input.startsAt), endsAt: toDate(input.endsAt),
        createdBy: ctx.principal.id, updatedBy: ctx.principal.id,
      })
      .returning();
    await ctx.emit("event.created", { eventId: row.id, kind: row.kind });
    return { id: row.id, number: row.number, slug: row.slug, status: row.status };
  },
});

export const eventGet = defineTool({
  name: "event.get",
  description: "Read one event with its sessions and its numbers: the registration funnel, leads, targets, budget, pipeline and survey score.",
  permission: "event.read",
  risk: "read",
  input: z.object({ eventId: z.uuid() }),
  async handler(ctx, { eventId }) {
    const [row] = await ctx.db.select().from(event).where(eq(event.id, eventId));
    if (!row) throw new ToolError("not_found", "No such event");
    const sessions = await ctx.db.select().from(eventSession).where(eq(eventSession.eventId, eventId));
    const [openTasks] = await ctx.db.select({ n: count() }).from(task).where(and(eq(task.eventId, eventId), eq(task.taskType, "task"), notInArray(task.state, ["done", "cancelled"])));
    const stats = { ...(await eventInsights(ctx.db, eventId)), openTasks: openTasks.n };
    return { ...row, sessions, stats };
  },
});

export const eventSetStatus = defineTool({
  name: "event.set_status",
  description: "Move an event between draft, live, closed and archived. Going live makes it public.",
  permission: "event.publish",
  risk: "external",
  input: z.object({ eventId: z.uuid(), status: z.enum(["draft", "live", "closed", "archived"]) }),
  async handler(ctx, { eventId, status }) {
    const [now] = await ctx.db.select({ status: event.status }).from(event).where(eq(event.id, eventId));
    if (!now) throw new ToolError("not_found", "No such event");
    if (now.status === "cancelled" && status !== "draft") throw new ToolError("cancelled", "This event was cancelled. Move it back to draft before taking it live again.");
    const [row] = await ctx.db
      .update(event)
      .set({ status, updatedBy: ctx.principal.id, updatedAt: new Date() })
      .where(eq(event.id, eventId))
      .returning({ id: event.id, status: event.status });
    await ctx.emit("event.status_changed", { eventId, status });
    return row;
  },
});

export const sessionCreate = defineTool({
  name: "session.create",
  description: "Add a session to a conference, optionally with speakers (who must already be contacts).",
  permission: "session.write",
  risk: "write",
  input: z.object({
    eventId: z.uuid(),
    title: z.string().min(2).max(200),
    abstract: z.string().max(4000).optional(),
    track: z.string().max(80).optional(), room: z.string().max(80).optional(),
    startsAt: when, endsAt: when,
    capacity: z.number().int().positive().optional(),
    speakerContactIds: z.array(z.uuid()).max(20).default([]),
  }),
  async handler(ctx, input) {
    const [parent] = await ctx.db.select({ kind: event.kind }).from(event).where(eq(event.id, input.eventId));
    if (!parent) throw new ToolError("not_found", "No such event");
    if (parent.kind !== "conference") throw new ToolError("wrong_kind", "Only conferences have sessions");
    const { speakerContactIds, startsAt, endsAt, ...rest } = input;
    const [row] = await ctx.db
      .insert(eventSession)
      .values({ ...rest, startsAt: toDate(startsAt), endsAt: toDate(endsAt), createdBy: ctx.principal.id, updatedBy: ctx.principal.id })
      .returning({ id: eventSession.id });
    if (speakerContactIds.length) {
      await ctx.db.insert(sessionSpeaker).values(speakerContactIds.map((contactId) => ({ sessionId: row.id, contactId })));
    }
    await ctx.emit("session.created", { eventId: input.eventId, sessionId: row.id });
    return row;
  },
});

export const sessionAddSpeaker = defineTool({
  name: "session.add_speaker",
  description: "Put an existing contact on a session as a speaker, moderator or panellist.",
  permission: "session.write",
  risk: "write",
  input: z.object({ sessionId: z.uuid(), contactId: z.uuid(), role: z.enum(["speaker", "moderator", "panellist"]).default("speaker") }),
  async handler(ctx, input) {
    const [s] = await ctx.db.select({ id: eventSession.id }).from(eventSession).where(eq(eventSession.id, input.sessionId));
    const [c] = await ctx.db.select({ id: contact.id }).from(contact).where(eq(contact.id, input.contactId));
    if (!s || !c) throw new ToolError("not_found", "No such session or contact");
    await ctx.db.insert(sessionSpeaker).values(input).onConflictDoUpdate({ target: [sessionSpeaker.sessionId, sessionSpeaker.contactId], set: { role: input.role } });
    return { added: true };
  },
});

export const eventPublicInfo = defineTool({
  name: "event.public_info",
  description: "What the public may know about an event: name, description, time, venue and, for conferences, the agenda. Nothing internal.",
  permission: "event.read",
  risk: "read",
  input: z.object({ eventId: z.uuid() }),
  async handler(ctx, { eventId }) {
    const [row] = await ctx.db.select().from(event).where(eq(event.id, eventId));
    if (!row || row.status === "draft" || row.status === "archived") throw new ToolError("not_found", "No such public event");
    const sessions = await ctx.db
      .select({ title: eventSession.title, abstract: eventSession.abstract, track: eventSession.track, room: eventSession.room, startsAt: eventSession.startsAt, endsAt: eventSession.endsAt })
      .from(eventSession).where(eq(eventSession.eventId, eventId));
    const speakers = await ctx.db.select({ sessionTitle: eventSession.title, firstName: contact.firstName, lastName: contact.lastName, title: contact.title })
      .from(sessionSpeaker).innerJoin(eventSession, eq(eventSession.id, sessionSpeaker.sessionId)).innerJoin(contact, eq(contact.id, sessionSpeaker.contactId)).where(eq(eventSession.eventId, eventId));
    return { name: row.name, host: row.hostName, description: row.description, kind: row.kind, status: row.status, startsAt: row.startsAt, endsAt: row.endsAt, timezone: row.timezone, venue: row.venue, mapLink: row.locationUrl, alsoOnline: Boolean(row.onlineUrl), registrationOpen: row.status === "live", needsApproval: row.requireApproval, sessions, speakers };
  },
});

export const formAddField = defineTool({
  name: "form.add_field",
  description: "Add a question to an event's registration form or to its lead capture screen.",
  permission: "event.write",
  risk: "write",
  input: z.object({
    eventId: z.uuid(),
    purpose: z.enum(["registration", "lead"]),
    label: z.string().trim().min(2).max(120),
    type: z.enum(["text", "select", "checkbox", "phone", "company", "website", "social", "terms"]).default("text").describe("terms is a statement the guest must tick to agree to; put the statement in the label"),
    options: z.array(z.string().trim().min(1).max(80)).max(30).default([]),
    required: z.boolean().default(false),
  }),
  async handler(ctx, input) {
    if (input.type === "select" && input.options.length < 2) throw new ToolError("no_options", "A choice question needs at least two options");
    const existing = await ctx.db.select({ key: formField.key }).from(formField).where(and(eq(formField.eventId, input.eventId), eq(formField.purpose, input.purpose)));
    const base = slugify(input.label).replace(/-/g, "_") || "question";
    let key = base;
    for (let n = 2; existing.some((f) => f.key === key); n++) key = `${base}_${n}`;
    const [row] = await ctx.db
      .insert(formField)
      .values({ ...input, required: input.type === "terms" ? true : input.required, options: input.type === "select" ? input.options : [], key, position: existing.length, createdBy: ctx.principal.id, updatedBy: ctx.principal.id })
      .returning({ id: formField.id, key: formField.key });
    return row;
  },
});

export const formRemoveField = defineTool({
  name: "form.remove_field",
  description: "Remove a question from a form. Answers already given are kept on the records.",
  permission: "event.write",
  risk: "write",
  input: z.object({ fieldId: z.uuid() }),
  async handler(ctx, { fieldId }) {
    const rows = await ctx.db.delete(formField).where(eq(formField.id, fieldId)).returning({ id: formField.id });
    if (rows.length === 0) throw new ToolError("not_found", "No such question");
    return { removed: true };
  },
});

/** Check submitted answers against an event's questions. Unknown keys are dropped; a missing required answer is refused. */
export async function readAnswers(db: Db, eventId: string, purpose: "registration" | "lead", raw: Record<string, unknown>): Promise<Record<string, string | boolean>> {
  const fields = await db.select().from(formField).where(and(eq(formField.eventId, eventId), eq(formField.purpose, purpose)));
  const answers: Record<string, string | boolean> = {};
  for (const field of fields) {
    const value = raw[field.key];
    if (field.type === "checkbox" || field.type === "terms") {
      const ticked = value === true || value === "on" || value === "true";
      // Terms are always required: registering without agreeing is not offered.
      if ((field.required || field.type === "terms") && !ticked) throw new ToolError("missing_answer", field.type === "terms" ? `Please agree to: ${field.label}` : `Please tick: ${field.label}`);
      answers[field.key] = ticked;
      continue;
    }
    let text = typeof value === "string" ? value.trim().slice(0, 2000) : "";
    if (!text) {
      if (field.required) throw new ToolError("missing_answer", `Please answer: ${field.label}`);
      continue;
    }
    if (field.type === "select" && !field.options.includes(text)) throw new ToolError("bad_answer", `Choose one of the options for: ${field.label}`);
    if (field.type === "phone" && !/^\+?[0-9][0-9 ().-]{6,19}$/.test(text)) throw new ToolError("bad_answer", `Enter a phone number for: ${field.label}`);
    if (field.type === "website") {
      // People type "acme.com"; keep it as a full address, and refuse anything that is not one.
      if (!/^https?:\/\//i.test(text)) text = `https://${text}`;
      if (!z.url().safeParse(text).success || !/^https?:\/\/[^\s/]+\.[^\s/]+/i.test(text)) throw new ToolError("bad_answer", `Enter a web address for: ${field.label}`);
    }
    answers[field.key] = text;
  }
  return answers;
}

export const eventUpdate = defineTool({
  name: "event.update",
  description: "Change an event's details: name, dates, venue, public description, cover image, map link, address of the public page, brief, capacity, targets, whether guests need approval, time zone and currency. Leave a field out to keep it; send null to clear one. Changing the time zone changes how times are shown, not the moments themselves. Changing the address breaks links already sent.",
  permission: "event.write",
  risk: "write",
  input: z.object({
    eventId: z.uuid(),
    name: z.string().trim().min(2).max(120).optional(),
    startsAt: when.nullable(), endsAt: when.nullable(),
    slug: slugText.optional().describe("The last part of the public page's address"),
    venue: z.string().max(200).nullable().optional(), brief: z.string().max(4000).nullable().optional(),
    description: z.string().max(10000).nullable().optional().describe("What guests read on the public page. Plain text; blank lines make paragraphs"),
    coverImageUrl: link.nullable().optional(), locationUrl: link.nullable().optional(),
    onlineUrl: link.nullable().optional().describe("Where to join online. Shown only to guests who hold a place"),
    requireApproval: z.boolean().optional().describe("When true, guests who register wait until someone approves them"),
    hostName: z.string().trim().max(120).nullable().optional().describe("Who is putting the event on, shown on the public page"),
    confirmationNote: z.string().max(2000).nullable().optional().describe("A few lines added to every confirmation email, e.g. parking or dress code"),
    reminders: z.boolean().optional().describe("Remind guests a day before and an hour before"),
    feedbackEmail: z.boolean().optional().describe("After the event, email everyone who attended and ask how it was"),
    capacity: z.number().int().positive().nullable().optional(),
    targetRegistrations: z.number().int().positive().nullable().optional(),
    targetLeads: z.number().int().positive().nullable().optional(),
    timezone: zone.optional(), currency: currencyCode.optional(),
  }),
  async handler(ctx, { eventId, startsAt, endsAt, ...changes }) {
    if (changes.slug) {
      const [taken] = await ctx.db.select({ id: event.id }).from(event).where(and(eq(event.slug, changes.slug), ne(event.id, eventId)));
      if (taken) throw new ToolError("slug_taken", "Another event already uses that address");
    }
    const dates = { ...(startsAt !== undefined ? { startsAt: toDate(startsAt) } : {}), ...(endsAt !== undefined ? { endsAt: toDate(endsAt) } : {}) };
    const [before] = await ctx.db.select({ startsAt: event.startsAt, endsAt: event.endsAt }).from(event).where(eq(event.id, eventId));
    if (!before) throw new ToolError("not_found", "No such event");
    const start = dates.startsAt !== undefined ? dates.startsAt : before.startsAt;
    const end = dates.endsAt !== undefined ? dates.endsAt : before.endsAt;
    if (start && end && end.getTime() <= start.getTime()) throw new ToolError("bad_dates", "The event must end after it starts");
    const [row] = await ctx.db.update(event).set({ ...changes, ...dates, updatedBy: ctx.principal.id, updatedAt: new Date() }).where(eq(event.id, eventId))
      .returning({ id: event.id, name: event.name, slug: event.slug, capacity: event.capacity, timezone: event.timezone, currency: event.currency });
    if (!row) throw new ToolError("not_found", "No such event");
    await ctx.emit("event.updated", { eventId });
    return row;
  },
});

export const eventClone = defineTool({
  name: "event.clone",
  description: "Start a new draft from an existing event: same type, venue, public description and picture, brief, capacity, targets, questions, planned budget and session outline. Guests, leads and messages are not copied.",
  permission: "event.write",
  risk: "write",
  input: z.object({ eventId: z.uuid(), name: z.string().min(2).max(120), startsAt: when }),
  async handler(ctx, { eventId, name, startsAt }) {
    const [src] = await ctx.db.select().from(event).where(eq(event.id, eventId));
    if (!src) throw new ToolError("not_found", "No such event");
    const number = await nextNumber(ctx.db, "EVT");
    const start = toDate(startsAt);
    const shift = start && src.startsAt ? start.getTime() - src.startsAt.getTime() : null;
    const moved = (d: Date | null) => (d && shift != null ? new Date(d.getTime() + shift) : null);
    const stamp = { createdBy: ctx.principal.id, updatedBy: ctx.principal.id };
    const [copy] = await ctx.db.insert(event).values({
      number, name, slug: `${slugify(name)}-${number.slice(-4)}`, kind: src.kind, timezone: src.timezone, venue: src.venue, brief: src.brief,
      capacity: src.capacity, targetRegistrations: src.targetRegistrations, targetLeads: src.targetLeads, currency: src.currency,
      description: src.description, coverImageUrl: src.coverImageUrl, locationUrl: src.locationUrl, requireApproval: src.requireApproval,
      hostName: src.hostName, confirmationNote: src.confirmationNote, reminders: src.reminders, feedbackEmail: src.feedbackEmail, onlineUrl: src.onlineUrl,
      startsAt: start, endsAt: moved(src.endsAt), ...stamp,
    }).returning();
    const fields = await ctx.db.select().from(formField).where(eq(formField.eventId, eventId));
    if (fields.length) await ctx.db.insert(formField).values(fields.map(({ id: _i, createdAt: _c, updatedAt: _u, ...f }) => ({ ...f, eventId: copy.id, ...stamp })));
    const sessions = await ctx.db.select().from(eventSession).where(eq(eventSession.eventId, eventId));
    if (sessions.length) await ctx.db.insert(eventSession).values(sessions.map(({ id: _i, createdAt: _c, updatedAt: _u, ...x }) => ({ ...x, eventId: copy.id, startsAt: moved(x.startsAt), endsAt: moved(x.endsAt), ...stamp })));
    const lines = await ctx.db.select().from(budgetItem).where(eq(budgetItem.eventId, eventId));
    if (lines.length) await ctx.db.insert(budgetItem).values(lines.map((l) => ({ eventId: copy.id, label: l.label, category: l.category, planned: l.planned, ...stamp })));
    await ctx.emit("event.created", { eventId: copy.id, kind: copy.kind, clonedFrom: eventId });
    return { id: copy.id, number: copy.number, slug: copy.slug };
  },
});

export const budgetSetItem = defineTool({
  name: "budget.set_item",
  description: "Add a budget line to an event, or update one: what it is, the planned amount and, once known, the actual amount.",
  permission: "event.write",
  risk: "write",
  input: z.object({
    eventId: z.uuid(), itemId: z.uuid().optional(),
    label: z.string().trim().min(2).max(120), category: z.string().max(60).optional(),
    planned: z.number().int().min(0).max(1_000_000_000), actual: z.number().int().min(0).max(1_000_000_000).nullable().optional(),
  }),
  async handler(ctx, { eventId, itemId, ...values }) {
    const stamp = { updatedBy: ctx.principal.id, updatedAt: new Date() };
    if (itemId) {
      const [row] = await ctx.db.update(budgetItem).set({ ...values, ...stamp }).where(and(eq(budgetItem.id, itemId), eq(budgetItem.eventId, eventId))).returning({ id: budgetItem.id });
      if (!row) throw new ToolError("not_found", "No such budget line");
      return row;
    }
    const [row] = await ctx.db.insert(budgetItem).values({ eventId, ...values, createdBy: ctx.principal.id, ...stamp }).returning({ id: budgetItem.id });
    return row;
  },
});

export const budgetRemoveItem = defineTool({
  name: "budget.remove_item",
  description: "Remove a budget line from an event.",
  permission: "event.write",
  risk: "write",
  input: z.object({ itemId: z.uuid() }),
  async handler(ctx, { itemId }) {
    const rows = await ctx.db.delete(budgetItem).where(eq(budgetItem.id, itemId)).returning({ id: budgetItem.id });
    if (rows.length === 0) throw new ToolError("not_found", "No such budget line");
    return { removed: true };
  },
});

export const eventCancel = defineTool({
  name: "event.cancel",
  description: "Call an event off. Registration shuts, the public page says it is cancelled, and everyone invited, registered or waiting is emailed once. An optional note from the organisers is added to the email.",
  permission: "event.publish",
  risk: "external",
  input: z.object({ eventId: z.uuid(), message: z.string().trim().max(2000).optional().describe("A sentence or two for guests, e.g. what happens next") }),
  async handler(ctx, { eventId, message }) {
    const [row] = await ctx.db.select().from(event).where(eq(event.id, eventId));
    if (!row) throw new ToolError("not_found", "No such event");
    if (row.status === "cancelled") return { cancelled: true, told: 0, already: true };
    await ctx.db.update(event).set({ status: "cancelled", updatedBy: ctx.principal.id, updatedAt: new Date() }).where(eq(event.id, eventId));
    // A draft was never public, so there is nobody to tell.
    const people = row.status === "draft" ? [] : await ctx.db
      .select({ r: registration, c: contact })
      .from(registration)
      .innerJoin(contact, eq(contact.id, registration.contactId))
      .where(and(eq(registration.eventId, eventId), inArray(registration.status, ["invited", "pending", "registered", "waitlisted"])));
    let told = 0;
    for (const { r, c } of people) {
      if (c.emailOptOutAt) continue;
      const lines = [`Hi ${c.firstName},`, "", `${row.name} has been cancelled.`, ...(message ? ["", message] : []), "", "We are sorry for the change of plan."];
      const mail = await withUnsubscribe(ctx.db, c.id, lines.join("\n"));
      const id = await ctx.enqueue({
        channel: "email", recipient: c.email, subject: `Cancelled: ${row.name}`, body: mail.body, meta: { unsubscribeUrl: mail.unsubscribeUrl },
        contactId: c.id, eventId, dedupeKey: `event-cancelled:${eventId}:${r.id}`,
      });
      if (id) told++;
    }
    await ctx.emit("event.cancelled", { eventId, told });
    return { cancelled: true, told, already: false };
  },
});

export const sessionUpdate = defineTool({
  name: "session.update",
  description: "Change a session: title, abstract, track, room, times or capacity. Leave a field out to keep it; send null to clear one.",
  permission: "session.write",
  risk: "write",
  input: z.object({
    sessionId: z.uuid(),
    title: z.string().trim().min(2).max(200).optional(),
    abstract: z.string().max(4000).nullable().optional(),
    track: z.string().trim().max(80).nullable().optional(), room: z.string().trim().max(80).nullable().optional(),
    startsAt: when.nullable(), endsAt: when.nullable(),
    capacity: z.number().int().positive().nullable().optional(),
  }),
  async handler(ctx, { sessionId, startsAt, endsAt, ...changes }) {
    const dates = { ...(startsAt !== undefined ? { startsAt: toDate(startsAt) } : {}), ...(endsAt !== undefined ? { endsAt: toDate(endsAt) } : {}) };
    const [row] = await ctx.db.update(eventSession).set({ ...changes, ...dates, updatedBy: ctx.principal.id, updatedAt: new Date() }).where(eq(eventSession.id, sessionId)).returning({ id: eventSession.id, eventId: eventSession.eventId });
    if (!row) throw new ToolError("not_found", "No such session");
    await ctx.emit("session.updated", { eventId: row.eventId, sessionId });
    return { id: row.id };
  },
});

export const sessionRemove = defineTool({
  name: "session.remove",
  description: "Take a session off the agenda, with its speaker slots. The speakers stay on record as contacts.",
  permission: "session.write",
  risk: "write",
  input: z.object({ sessionId: z.uuid() }),
  async handler(ctx, { sessionId }) {
    const rows = await ctx.db.delete(eventSession).where(eq(eventSession.id, sessionId)).returning({ eventId: eventSession.eventId });
    if (rows.length === 0) throw new ToolError("not_found", "No such session");
    await ctx.emit("session.removed", { eventId: rows[0].eventId, sessionId });
    return { removed: true };
  },
});

export const sessionRemoveSpeaker = defineTool({
  name: "session.remove_speaker",
  description: "Take a speaker off a session. They stay on record as a contact.",
  permission: "session.write",
  risk: "write",
  input: z.object({ sessionId: z.uuid(), contactId: z.uuid() }),
  async handler(ctx, { sessionId, contactId }) {
    const rows = await ctx.db.delete(sessionSpeaker).where(and(eq(sessionSpeaker.sessionId, sessionId), eq(sessionSpeaker.contactId, contactId))).returning({ sessionId: sessionSpeaker.sessionId });
    if (rows.length === 0) throw new ToolError("not_found", "That person is not a speaker on that session");
    return { removed: true };
  },
});
