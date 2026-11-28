import { randomInt } from "node:crypto";
import { and, asc, count, eq, inArray, ne } from "drizzle-orm";
import type { Db } from "@/db/client";
import { z } from "zod";
import { contact, event, lead, registration, surveyResponse, sysJournal } from "@/db/schema";
import { nextNumber } from "@/platform/numbers";
import { defineTool, ToolError } from "@/platform/tools";
import { readAnswers } from "./events";

/** Whether a new guest gets a place or joins the waitlist. */
async function placeFor(db: Db, eventId: string, capacity: number | null): Promise<"registered" | "waitlisted"> {
  if (capacity == null) return "registered";
  const [taken] = await db.select({ n: count() }).from(registration).where(and(eq(registration.eventId, eventId), inArray(registration.status, ["registered", "attended"])));
  return taken.n < capacity ? "registered" : "waitlisted";
}

export const contactUpsert = defineTool({
  name: "contact.upsert",
  description: "Create a contact, or update the existing one with the same email. One person is one contact across all events.",
  permission: "contact.write",
  risk: "write",
  input: z.object({
    email: z.email().transform((e) => e.trim().toLowerCase()),
    firstName: z.string().min(1).max(80),
    lastName: z.string().max(80).optional(),
    phone: z.string().regex(/^\+[1-9]\d{7,14}$/, "Use international format, e.g. +919876543210").optional(),
    title: z.string().max(120).optional(),
    whatsappOptIn: z.boolean().optional().describe("True only when the person has agreed to WhatsApp messages"),
  }),
  async handler(ctx, { whatsappOptIn, ...fields }) {
    const stamp = { updatedBy: ctx.principal.id, updatedAt: new Date() };
    const optIn = whatsappOptIn ? { whatsappOptInAt: new Date() } : {};
    const [row] = await ctx.db
      .insert(contact)
      .values({ ...fields, ...optIn, ...stamp, createdBy: ctx.principal.id })
      .onConflictDoUpdate({ target: contact.email, set: { ...fields, ...optIn, ...stamp } })
      .returning({ id: contact.id, email: contact.email });
    return row;
  },
});

export const registrationCreate = defineTool({
  name: "registration.create",
  description: "Register a contact for an event. Registering the same person twice returns the existing registration.",
  permission: "registration.write",
  risk: "write",
  input: z.object({
    eventId: z.uuid(), contactId: z.uuid(),
    status: z.enum(["invited", "registered", "waitlisted"]).default("registered"),
    source: z.string().max(80).optional(),
  }),
  async handler(ctx, input) {
    const [existing] = await ctx.db
      .select({ id: registration.id, number: registration.number, status: registration.status })
      .from(registration)
      .where(and(eq(registration.eventId, input.eventId), eq(registration.contactId, input.contactId)));
    if (existing) return { ...existing, created: false };
    const [parent] = await ctx.db.select({ id: event.id }).from(event).where(eq(event.id, input.eventId));
    if (!parent) throw new ToolError("not_found", "No such event");
    const [cap] = await ctx.db.select({ capacity: event.capacity }).from(event).where(eq(event.id, input.eventId));
    const status = input.status === "registered" ? await placeFor(ctx.db, input.eventId, cap.capacity) : input.status;
    const [row] = await ctx.db
      .insert(registration)
      .values({ ...input, status, number: await nextNumber(ctx.db, "REG"), createdBy: ctx.principal.id, updatedBy: ctx.principal.id })
      .returning({ id: registration.id, number: registration.number, status: registration.status });
    if (status !== "invited") await ctx.emit("registration.created", { eventId: input.eventId, registrationId: row.id, contactId: input.contactId, status });
    return { ...row, created: true };
  },
});

export const registrationCheckIn = defineTool({
  name: "registration.check_in",
  description: "Check a registered guest in at the door and issue their PIN.",
  permission: "checkin.write",
  risk: "write",
  input: z.object({ registrationId: z.uuid() }),
  async handler(ctx, { registrationId }) {
    const [row] = await ctx.db.select().from(registration).where(eq(registration.id, registrationId));
    if (!row) throw new ToolError("not_found", "No such registration");
    if (row.checkedInAt) return { id: row.id, pin: row.pin, alreadyCheckedIn: true };
    if (row.status === "cancelled" || row.status === "declined") throw new ToolError("cancelled", "This guest cancelled or declined");
    if (row.status === "pending") throw new ToolError("not_approved", "This guest has not been approved yet");
    const pin = String(randomInt(0, 1_000_000)).padStart(6, "0");
    await ctx.db
      .update(registration)
      .set({ status: "attended", pin, checkedInAt: new Date(), checkedInBy: ctx.principal.id, updatedBy: ctx.principal.id, updatedAt: new Date() })
      .where(eq(registration.id, registrationId));
    await ctx.emit("checkin.confirmed", { eventId: row.eventId, registrationId, contactId: row.contactId });
    return { id: row.id, pin, alreadyCheckedIn: false };
  },
});

export const leadCapture = defineTool({
  name: "lead.capture",
  description: "Record a conversation with a contact at a booth or in the field.",
  permission: "lead.write",
  risk: "write",
  input: z.object({
    eventId: z.uuid(), contactId: z.uuid(),
    notes: z.string().max(4000).optional(),
    answers: z.record(z.string(), z.unknown()).default({}),
  }),
  async handler(ctx, input) {
    const answers = await readAnswers(ctx.db, input.eventId, "lead", input.answers);
    const [row] = await ctx.db
      .insert(lead)
      .values({ ...input, answers, number: await nextNumber(ctx.db, "LEAD"), capturedBy: ctx.principal.id, createdBy: ctx.principal.id, updatedBy: ctx.principal.id })
      .returning({ id: lead.id, number: lead.number });
    await ctx.emit("lead.captured", { eventId: input.eventId, leadId: row.id, contactId: input.contactId });
    return row;
  },
});

export const registrationRegisterGuest = defineTool({
  name: "registration.register_guest",
  description:
    "Self-registration from the public event page. Works only while the event is live. Never changes an existing contact's details. When the event approves each guest, the result is a pending request, not a place.",
  permission: "registration.write",
  risk: "write",
  input: z.object({
    eventSlug: z.string().min(1).max(80),
    email: z.email().transform((e) => e.trim().toLowerCase()),
    firstName: z.string().trim().min(1).max(80),
    lastName: z.string().trim().max(80).optional(),
    phone: z.string().regex(/^\+[1-9]\d{7,14}$/, "Use international format, e.g. +919876543210").optional(),
    whatsappOptIn: z.boolean().default(false),
    answers: z.record(z.string(), z.unknown()).default({}).describe("Answers to the event's own registration questions, by key"),
  }),
  async handler(ctx, input) {
    const [target] = await ctx.db.select().from(event).where(eq(event.slug, input.eventSlug));
    if (!target || target.status !== "live") throw new ToolError("not_open", "Registration is not open for this event");
    const answers = await readAnswers(ctx.db, target.id, "registration", input.answers);

    // A stranger typing someone else's email must not be able to rewrite that person's record.
    const { eventSlug: _slug, whatsappOptIn, answers: _raw, ...fields } = input;
    const optIn = whatsappOptIn && fields.phone ? { whatsappOptInAt: new Date() } : {};
    await ctx.db.insert(contact).values({ ...fields, ...optIn, createdBy: ctx.principal.id, updatedBy: ctx.principal.id }).onConflictDoNothing();
    const [person] = await ctx.db.select({ id: contact.id }).from(contact).where(eq(contact.email, input.email));

    const [existing] = await ctx.db
      .select({ id: registration.id })
      .from(registration)
      .where(and(eq(registration.eventId, target.id), eq(registration.contactId, person.id)));
    if (existing) return { registered: true, created: false, status: "existing" as const };
    const status = target.requireApproval ? ("pending" as const) : await placeFor(ctx.db, target.id, target.capacity);
    const [row] = await ctx.db
      .insert(registration)
      .values({
        eventId: target.id, contactId: person.id, source: "web", status, number: await nextNumber(ctx.db, "REG"), custom: answers,
        createdBy: ctx.principal.id, updatedBy: ctx.principal.id,
      })
      .returning({ id: registration.id });
    // A request tells the guest it was received; a place tells them they are in.
    await ctx.emit(status === "pending" ? "registration.requested" : "registration.created", { eventId: target.id, registrationId: row.id, contactId: person.id, status });
    // The id is given only for a registration made just now, by this person. One that already existed may be someone else's.
    return { registered: true, created: true, status, registrationId: row.id };
  },
});

export const registrationExport = defineTool({
  name: "registration.export",
  description: "List every registration for an event with contact details, for export.",
  permission: "contact.read",
  risk: "read",
  input: z.object({ eventId: z.uuid() }),
  async handler(ctx, { eventId }) {
    const rows = await ctx.db
      .select({
        number: registration.number, status: registration.status, source: registration.source, checkedInAt: registration.checkedInAt, answers: registration.custom,
        firstName: contact.firstName, lastName: contact.lastName, email: contact.email, phone: contact.phone, title: contact.title,
      })
      .from(registration)
      .innerJoin(contact, eq(contact.id, registration.contactId))
      .where(eq(registration.eventId, eventId));
    return { count: rows.length, rows };
  },
});

export const leadGet = defineTool({
  name: "lead.get",
  description: "Read one lead with the contact it belongs to and the event it was captured at.",
  permission: "contact.read",
  risk: "read",
  input: z.object({ leadId: z.uuid() }),
  async handler(ctx, { leadId }) {
    const [row] = await ctx.db
      .select({ lead, contact, eventName: event.name, eventKind: event.kind })
      .from(lead)
      .innerJoin(contact, eq(contact.id, lead.contactId))
      .innerJoin(event, eq(event.id, lead.eventId))
      .where(eq(lead.id, leadId));
    if (!row) throw new ToolError("not_found", "No such lead");
    return row;
  },
});

export const leadScore = defineTool({
  name: "lead.score",
  description: "Score a lead from 0 to 100 and give the reason. 70 and above is hot, 40 to 69 warm, below 40 cold.",
  permission: "lead.write",
  risk: "write",
  input: z.object({ leadId: z.uuid(), score: z.number().int().min(0).max(100), reason: z.string().min(3).max(600) }),
  async handler(ctx, { leadId, score, reason }) {
    const band = score >= 70 ? "hot" : score >= 40 ? "warm" : "cold";
    const [row] = await ctx.db
      .update(lead)
      .set({ score, band, updatedBy: ctx.principal.id, updatedAt: new Date() })
      .where(eq(lead.id, leadId))
      .returning({ id: lead.id, eventId: lead.eventId });
    if (!row) throw new ToolError("not_found", "No such lead");
    await ctx.db.insert(sysJournal).values({ tableName: "lead", recordId: leadId, authorId: ctx.principal.id, body: `Scored ${score} (${band}): ${reason}` });
    await ctx.emit("lead.scored", { leadId, eventId: row.eventId, score, band });
    return { id: row.id, score, band };
  },
});

export const guestImport = defineTool({
  name: "guest.import",
  description: "Put a list of people on an event's guest list as invited. New people become contacts; existing contacts are never changed. Nobody is emailed by this.",
  permission: "registration.write",
  risk: "write",
  input: z.object({
    eventId: z.uuid(),
    rows: z.array(z.object({ email: z.string(), firstName: z.string(), lastName: z.string().optional(), title: z.string().optional(), phone: z.string().optional() })).min(1).max(2000),
  }),
  async handler(ctx, { eventId, rows }) {
    const [target] = await ctx.db.select({ id: event.id }).from(event).where(eq(event.id, eventId));
    if (!target) throw new ToolError("not_found", "No such event");
    let invited = 0, alreadyOnList = 0;
    const invalid: string[] = [];
    for (const raw of rows) {
      const email = raw.email.trim().toLowerCase();
      const firstName = raw.firstName.trim();
      if (!z.email().safeParse(email).success || !firstName) { invalid.push(raw.email.slice(0, 80)); continue; }
      const phone = raw.phone && /^\+[1-9]\d{7,14}$/.test(raw.phone.trim()) ? raw.phone.trim() : undefined;
      await ctx.db.insert(contact).values({ email, firstName, lastName: raw.lastName?.trim() || null, title: raw.title?.trim() || null, phone, createdBy: ctx.principal.id, updatedBy: ctx.principal.id }).onConflictDoNothing();
      const [person] = await ctx.db.select({ id: contact.id }).from(contact).where(eq(contact.email, email));
      const made = await ctx.db.insert(registration)
        .values({ eventId, contactId: person.id, status: "invited", source: "import", number: await nextNumber(ctx.db, "REG"), createdBy: ctx.principal.id, updatedBy: ctx.principal.id })
        .onConflictDoNothing().returning({ id: registration.id });
      if (made.length) invited++; else alreadyOnList++;
    }
    return { invited, alreadyOnList, invalid };
  },
});

export const registrationRsvp = defineTool({
  name: "registration.rsvp",
  description: "Record an invited guest's reply. Yes gives them a place, or a waitlist spot when the event is full. No marks them declined.",
  permission: "registration.write",
  risk: "write",
  input: z.object({ registrationId: z.uuid(), answer: z.enum(["yes", "no"]), answers: z.record(z.string(), z.unknown()).default({}) }),
  async handler(ctx, { registrationId, answer, answers: raw }) {
    const [row] = await ctx.db.select({ r: registration, e: event }).from(registration).innerJoin(event, eq(event.id, registration.eventId)).where(eq(registration.id, registrationId));
    if (!row) throw new ToolError("not_found", "No such invitation");
    if (!["invited", "declined", "cancelled"].includes(row.r.status)) return { status: row.r.status, changed: false };
    if (row.e.status !== "live") throw new ToolError("not_open", "Replies are not open for this event");
    if (answer === "no") {
      await ctx.db.update(registration).set({ status: "declined", updatedBy: ctx.principal.id, updatedAt: new Date() }).where(eq(registration.id, registrationId));
      return { status: "declined" as const, changed: true };
    }
    const answers = await readAnswers(ctx.db, row.e.id, "registration", raw);
    // Someone the team invited by name is already approved. Someone coming back after declining or cancelling asks again.
    const status = row.e.requireApproval && row.r.status !== "invited" ? ("pending" as const) : await placeFor(ctx.db, row.e.id, row.e.capacity);
    await ctx.db.update(registration).set({ status, custom: answers, updatedBy: ctx.principal.id, updatedAt: new Date() }).where(eq(registration.id, registrationId));
    await ctx.emit(status === "pending" ? "registration.requested" : "registration.created", { eventId: row.e.id, registrationId, contactId: row.r.contactId, status });
    return { status, changed: true };
  },
});

export const registrationCancel = defineTool({
  name: "registration.cancel",
  description: "Cancel a guest's place. If people are waiting, the one who has waited longest is given the place and told.",
  permission: "registration.write",
  risk: "write",
  input: z.object({ registrationId: z.uuid() }),
  async handler(ctx, { registrationId }) {
    const [row] = await ctx.db.select().from(registration).where(eq(registration.id, registrationId));
    if (!row) throw new ToolError("not_found", "No such registration");
    if (row.checkedInAt) throw new ToolError("attended", "This guest has already checked in");
    if (row.status === "cancelled") return { cancelled: true, promoted: null };
    const heldPlace = row.status === "registered";
    await ctx.db.update(registration).set({ status: "cancelled", updatedBy: ctx.principal.id, updatedAt: new Date() }).where(eq(registration.id, registrationId));
    await ctx.emit("registration.cancelled", { eventId: row.eventId, registrationId, contactId: row.contactId });
    let promoted: string | null = null;
    if (heldPlace) {
      const [next] = await ctx.db.select().from(registration).where(and(eq(registration.eventId, row.eventId), eq(registration.status, "waitlisted"))).orderBy(asc(registration.createdAt)).limit(1);
      if (next) {
        await ctx.db.update(registration).set({ status: "registered", updatedBy: ctx.principal.id, updatedAt: new Date() }).where(eq(registration.id, next.id));
        await ctx.emit("registration.created", { eventId: row.eventId, registrationId: next.id, contactId: next.contactId, status: "registered", promoted: true });
        promoted = next.id;
      }
    }
    return { cancelled: true, promoted };
  },
});

export const surveySubmit = defineTool({
  name: "survey.submit",
  description: "Record a guest's answer to how likely they are to recommend the event (0 to 10), with an optional comment. One answer per guest; a second replaces the first.",
  permission: "registration.write",
  risk: "write",
  input: z.object({ registrationId: z.uuid(), score: z.number().int().min(0).max(10), comment: z.string().trim().max(2000).optional() }),
  async handler(ctx, { registrationId, score, comment }) {
    const [row] = await ctx.db.select().from(registration).where(eq(registration.id, registrationId));
    if (!row?.checkedInAt) throw new ToolError("not_attended", "Only guests who attended can answer");
    const values = { score, comment: comment || null, updatedBy: ctx.principal.id, updatedAt: new Date() };
    await ctx.db.insert(surveyResponse).values({ eventId: row.eventId, registrationId, ...values, createdBy: ctx.principal.id }).onConflictDoUpdate({ target: surveyResponse.registrationId, set: values });
    await ctx.emit("survey.submitted", { eventId: row.eventId, registrationId, score });
    return { recorded: true };
  },
});

export const leadSetValue = defineTool({
  name: "lead.set_value",
  description: "Record what a lead could be worth, as judged by the salesperson. Send null to clear it.",
  permission: "lead.write",
  risk: "write",
  input: z.object({ leadId: z.uuid(), pipelineValue: z.number().int().min(0).max(1_000_000_000).nullable() }),
  async handler(ctx, { leadId, pipelineValue }) {
    const [row] = await ctx.db.update(lead).set({ pipelineValue, updatedBy: ctx.principal.id, updatedAt: new Date() }).where(eq(lead.id, leadId)).returning({ id: lead.id, eventId: lead.eventId });
    if (!row) throw new ToolError("not_found", "No such lead");
    await ctx.emit("lead.valued", { leadId, eventId: row.eventId, pipelineValue });
    return { id: row.id, pipelineValue };
  },
});

export const registrationApprove = defineTool({
  name: "registration.approve",
  description: "Approve a guest who asked to join an event that approves each guest. They get a place, or a waitlist spot when the event is full, and are emailed.",
  permission: "registration.write",
  risk: "write",
  input: z.object({ registrationId: z.uuid() }),
  async handler(ctx, { registrationId }) {
    const [row] = await ctx.db.select({ r: registration, e: event }).from(registration).innerJoin(event, eq(event.id, registration.eventId)).where(eq(registration.id, registrationId));
    if (!row) throw new ToolError("not_found", "No such registration");
    if (row.r.status !== "pending") return { status: row.r.status, changed: false };
    const status = await placeFor(ctx.db, row.e.id, row.e.capacity);
    await ctx.db.update(registration).set({ status, updatedBy: ctx.principal.id, updatedAt: new Date() }).where(eq(registration.id, registrationId));
    await ctx.emit("registration.created", { eventId: row.e.id, registrationId, contactId: row.r.contactId, status, approved: true });
    return { status, changed: true };
  },
});

export const registrationDecline = defineTool({
  name: "registration.decline",
  description: "Turn down a guest who asked to join an event that approves each guest. They are told by email.",
  permission: "registration.write",
  risk: "write",
  input: z.object({ registrationId: z.uuid() }),
  async handler(ctx, { registrationId }) {
    const [row] = await ctx.db.select().from(registration).where(eq(registration.id, registrationId));
    if (!row) throw new ToolError("not_found", "No such registration");
    if (row.status !== "pending") return { status: row.status, changed: false };
    await ctx.db.update(registration).set({ status: "declined", updatedBy: ctx.principal.id, updatedAt: new Date() }).where(eq(registration.id, registrationId));
    await ctx.emit("registration.turned_down", { eventId: row.eventId, registrationId, contactId: row.contactId });
    return { status: "declined" as const, changed: true };
  },
});

export const registrationUndoCheckIn = defineTool({
  name: "registration.undo_check_in",
  description: "Take back a check-in made by mistake. The guest keeps their place and can be checked in again.",
  permission: "checkin.write",
  risk: "write",
  input: z.object({ registrationId: z.uuid() }),
  async handler(ctx, { registrationId }) {
    const [row] = await ctx.db.select().from(registration).where(eq(registration.id, registrationId));
    if (!row) throw new ToolError("not_found", "No such registration");
    if (!row.checkedInAt) return { undone: false };
    await ctx.db
      .update(registration)
      .set({ status: "registered", pin: null, checkedInAt: null, checkedInBy: null, updatedBy: ctx.principal.id, updatedAt: new Date() })
      .where(eq(registration.id, registrationId));
    // An answer to "how was the event?" from someone who, it turns out, was not there is removed with the check-in.
    await ctx.db.delete(surveyResponse).where(eq(surveyResponse.registrationId, registrationId));
    await ctx.emit("checkin.undone", { eventId: row.eventId, registrationId, contactId: row.contactId });
    return { undone: true };
  },
});

export const registrationWalkIn = defineTool({
  name: "registration.walk_in",
  description: "Register someone who turned up at the door and check them in, in one step. Never changes an existing contact's details. Works when the event is full: the person is already in the room.",
  permission: "checkin.write",
  risk: "write",
  input: z.object({
    eventId: z.uuid(),
    // Typed in a hurry at a door: forgive stray spaces and capitals.
    email: z.string().trim().toLowerCase().pipe(z.email()),
    firstName: z.string().trim().min(1).max(80),
    lastName: z.string().trim().max(80).optional(),
  }),
  async handler(ctx, { eventId, ...fields }) {
    const [target] = await ctx.db.select({ id: event.id, status: event.status }).from(event).where(eq(event.id, eventId));
    if (!target) throw new ToolError("not_found", "No such event");
    if (target.status === "cancelled" || target.status === "archived") throw new ToolError("not_open", "This event is not running");
    await ctx.db.insert(contact).values({ ...fields, createdBy: ctx.principal.id, updatedBy: ctx.principal.id }).onConflictDoNothing();
    const [person] = await ctx.db.select({ id: contact.id }).from(contact).where(eq(contact.email, fields.email));
    const stamp = { updatedBy: ctx.principal.id, updatedAt: new Date() };
    const [existing] = await ctx.db.select().from(registration).where(and(eq(registration.eventId, eventId), eq(registration.contactId, person.id)));
    if (existing?.checkedInAt) return { id: existing.id, number: existing.number, pin: existing.pin, alreadyCheckedIn: true };
    const pin = String(randomInt(0, 1_000_000)).padStart(6, "0");
    const arrived = { status: "attended" as const, pin, checkedInAt: new Date(), checkedInBy: ctx.principal.id, ...stamp };
    const [row] = existing
      ? await ctx.db.update(registration).set(arrived).where(eq(registration.id, existing.id)).returning({ id: registration.id, number: registration.number })
      : await ctx.db.insert(registration).values({ eventId, contactId: person.id, source: "walk-in", number: await nextNumber(ctx.db, "REG"), createdBy: ctx.principal.id, ...arrived }).returning({ id: registration.id, number: registration.number });
    await ctx.emit("checkin.confirmed", { eventId, registrationId: row.id, contactId: person.id, walkIn: !existing });
    return { id: row.id, number: row.number, pin, alreadyCheckedIn: false };
  },
});

export const contactUpdate = defineTool({
  name: "contact.update",
  description: "Correct a person's details: name, email, phone or job title. Leave a field out to keep it; send null to clear phone, last name or title. The change shows on every event they are part of.",
  permission: "contact.write",
  risk: "write",
  input: z.object({
    contactId: z.uuid(),
    firstName: z.string().trim().min(1).max(80).optional(),
    lastName: z.string().trim().max(80).nullable().optional(),
    email: z.string().trim().toLowerCase().pipe(z.email()).optional(),
    phone: z.string().trim().regex(/^\+[1-9]\d{7,14}$/, "Use international format, e.g. +919876543210").nullable().optional(),
    title: z.string().trim().max(120).nullable().optional(),
  }),
  async handler(ctx, { contactId, ...changes }) {
    if (changes.email) {
      const [taken] = await ctx.db.select({ id: contact.id }).from(contact).where(and(eq(contact.email, changes.email), ne(contact.id, contactId)));
      if (taken) throw new ToolError("email_taken", "Someone else on record already has that email");
    }
    // A phone number that is removed takes the WhatsApp opt-in with it: the consent was for that number.
    const consent = changes.phone === null ? { whatsappOptInAt: null } : {};
    const [row] = await ctx.db.update(contact).set({ ...changes, ...consent, updatedBy: ctx.principal.id, updatedAt: new Date() }).where(eq(contact.id, contactId)).returning({ id: contact.id, email: contact.email });
    if (!row) throw new ToolError("not_found", "No such person");
    return row;
  },
});

export const registrationCheckInByNumber = defineTool({
  name: "registration.check_in_by_number",
  description: "Check a guest in from the number on their pass, as read from its QR code. The pass must belong to this event.",
  permission: "checkin.write",
  risk: "write",
  input: z.object({ eventId: z.uuid(), number: z.string().trim().toUpperCase().regex(/^REG\d{1,12}$/, "That is not a pass number") }),
  async handler(ctx, { eventId, number }) {
    const [row] = await ctx.db.select({ r: registration, firstName: contact.firstName, lastName: contact.lastName }).from(registration).innerJoin(contact, eq(contact.id, registration.contactId)).where(eq(registration.number, number));
    if (!row || row.r.eventId !== eventId) throw new ToolError("wrong_event", "That pass is not for this event");
    const name = [row.firstName, row.lastName].filter(Boolean).join(" ");
    if (row.r.checkedInAt) return { id: row.r.id, name, pin: row.r.pin, alreadyCheckedIn: true };
    if (row.r.status === "cancelled" || row.r.status === "declined") throw new ToolError("cancelled", `${name} cancelled or declined`);
    if (row.r.status === "pending") throw new ToolError("not_approved", `${name} has not been approved yet`);
    if (row.r.status === "waitlisted") throw new ToolError("waitlisted", `${name} is on the waitlist and does not have a place`);
    const pin = String(randomInt(0, 1_000_000)).padStart(6, "0");
    await ctx.db.update(registration).set({ status: "attended", pin, checkedInAt: new Date(), checkedInBy: ctx.principal.id, updatedBy: ctx.principal.id, updatedAt: new Date() }).where(eq(registration.id, row.r.id));
    await ctx.emit("checkin.confirmed", { eventId, registrationId: row.r.id, contactId: row.r.contactId, scanned: true });
    return { id: row.r.id, name, pin, alreadyCheckedIn: false };
  },
});
