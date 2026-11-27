import { randomUUID } from "node:crypto";
import { and, eq, gt, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/db/client";
import { contact, event, registration, sysOutbox } from "@/db/schema";
import { appUrl, signedToken } from "@/platform/properties";
import { defineTool, ToolError } from "@/platform/tools";

/** Every guest email carries a way out. Returns the body with the footer, and the link for the mail header. */
export async function withUnsubscribe(db: Db, contactId: string, body: string) {
  const unsubscribeUrl = `${appUrl()}/u/${await signedToken(db, "unsubscribe", contactId)}`;
  return { body: `${body}\n\n—\nTo stop receiving these emails: ${unsubscribeUrl}`, unsubscribeUrl };
}

export const messageSend = defineTool({
  name: "message.send",
  description:
    "Queue an email or WhatsApp message to one contact. Refused when the contact has opted out of email, or has not opted in to WhatsApp.",
  permission: "message.send",
  risk: "external",
  input: z.object({
    contactId: z.uuid(),
    channel: z.enum(["email", "whatsapp"]),
    subject: z.string().max(200).optional(),
    body: z.string().min(1).max(8000),
    eventId: z.uuid().optional(),
    dedupeKey: z.string().max(200).optional().describe("Same key twice sends once"),
  }),
  async handler(ctx, input) {
    const [person] = await ctx.db.select().from(contact).where(eq(contact.id, input.contactId));
    if (!person) throw new ToolError("not_found", "No such contact");
    let recipient: string;
    if (input.channel === "email") {
      if (person.emailOptOutAt) throw new ToolError("no_consent", "This contact has unsubscribed from email");
      if (!input.subject) throw new ToolError("no_subject", "An email needs a subject");
      recipient = person.email;
    } else {
      if (!person.whatsappOptInAt) throw new ToolError("no_consent", "This contact has not opted in to WhatsApp");
      if (!person.phone) throw new ToolError("no_phone", "This contact has no phone number");
      recipient = person.phone;
    }
    const mail = input.channel === "email" ? await withUnsubscribe(ctx.db, person.id, input.body) : null;
    const id = await ctx.enqueue({
      channel: input.channel, recipient, subject: input.subject ?? null, body: mail?.body ?? input.body,
      meta: mail ? { unsubscribeUrl: mail.unsubscribeUrl } : {},
      contactId: person.id, eventId: input.eventId ?? null, dedupeKey: input.dedupeKey ?? null,
    });
    if (id) await ctx.emit("message.queued", { outboxId: id, channel: input.channel, contactId: person.id });
    return { outboxId: id, queued: id !== null };
  },
});

const SEGMENTS = ["all", "not_checked_in", "checked_in", "invited"] as const;

export const campaignSend = defineTool({
  name: "campaign.send",
  description:
    "Send one message to a segment of an event's guests. Use {{first_name}}, {{event_name}}, {{pass_url}} and, for invitations, {{rsvp_url}} in the text. People without consent for the channel are skipped. One approval covers the whole send.",
  permission: "message.send",
  risk: "external",
  input: z.object({
    eventId: z.uuid(),
    segment: z.enum(SEGMENTS).describe("all (everyone holding a place), not_checked_in (registered, not yet arrived), checked_in, or invited (asked, not yet replied)"),
    channel: z.enum(["email", "whatsapp"]),
    subject: z.string().max(200).optional(),
    body: z.string().min(1).max(8000),
    key: z.string().max(80).optional().describe("Sending again with the same key reaches nobody twice"),
    sendAt: z.iso.datetime({ offset: true }).optional().describe("Leave out to send now. A later time holds the messages until then; who receives them is decided now, not then"),
  }),
  async handler(ctx, input) {
    const [target] = await ctx.db.select().from(event).where(eq(event.id, input.eventId));
    if (!target) throw new ToolError("not_found", "No such event");
    if (input.channel === "email" && !input.subject) throw new ToolError("no_subject", "An email needs a subject");
    // "Registered" means holding a place: people still deciding, waiting or cancelled are not reminded or updated.
    const segment = {
      all: inArray(registration.status, ["registered", "attended"]),
      not_checked_in: eq(registration.status, "registered"),
      checked_in: isNotNull(registration.checkedInAt),
      invited: eq(registration.status, "invited"),
    }[input.segment];
    const people = await ctx.db
      .select({ r: registration, c: contact })
      .from(registration)
      .innerJoin(contact, eq(contact.id, registration.contactId))
      .where(and(eq(registration.eventId, input.eventId), segment))
      .limit(5000);
    const key = input.key ?? randomUUID();
    const sendAt = input.sendAt ? new Date(input.sendAt) : null;
    if (sendAt && sendAt.getTime() > Date.now() + 90 * 86_400_000) throw new ToolError("too_far", "A message can be scheduled up to 90 days ahead");
    const later = sendAt && sendAt.getTime() > Date.now() ? { nextAttemptAt: sendAt } : {};
    let queued = 0, skipped = 0;
    for (const { r, c } of people) {
      const allowed = r.status !== "cancelled" && r.status !== "declined" && (input.channel === "email" ? !c.emailOptOutAt : Boolean(c.whatsappOptInAt && c.phone));
      if (!allowed) { skipped++; continue; }
      const fill = (text: string) =>
        text.replaceAll("{{first_name}}", c.firstName).replaceAll("{{event_name}}", target.name).replaceAll("{{pass_url}}", `${appUrl()}/e/${target.slug}/pass/${r.id}`).replaceAll("{{rsvp_url}}", `${appUrl()}/e/${target.slug}/pass/${r.id}`);
      const mail = input.channel === "email" ? await withUnsubscribe(ctx.db, c.id, fill(input.body)) : null;
      const id = await ctx.enqueue({
        channel: input.channel, recipient: input.channel === "email" ? c.email : c.phone!,
        subject: input.subject ? fill(input.subject) : null, body: mail?.body ?? fill(input.body),
        meta: mail ? { unsubscribeUrl: mail.unsubscribeUrl, campaign: key } : { campaign: key },
        contactId: c.id, eventId: target.id, dedupeKey: `campaign:${target.id}:${key}:${r.id}`, ...later,
      });
      if (id) queued++;
    }
    await ctx.emit("campaign.sent", { eventId: target.id, key, queued, skipped });
    return { key, matched: people.length, queued, skipped, sendAt: "nextAttemptAt" in later ? sendAt!.toISOString() : null };
  },
});

export const contactUnsubscribe = defineTool({
  name: "contact.unsubscribe",
  description: "Record that a contact no longer wants email. Used by the unsubscribe link.",
  permission: "consent.write",
  risk: "write",
  input: z.object({ contactId: z.uuid() }),
  async handler(ctx, { contactId }) {
    await ctx.db.update(contact).set({ emailOptOutAt: new Date(), updatedBy: ctx.principal.id, updatedAt: new Date() }).where(and(eq(contact.id, contactId), isNull(contact.emailOptOutAt)));
    return { unsubscribed: true };
  },
});

export const campaignUnschedule = defineTool({
  name: "campaign.unschedule",
  description: "Stop a scheduled message to guests before it goes out. Messages already sent are not affected.",
  permission: "message.send",
  risk: "write",
  input: z.object({ eventId: z.uuid(), key: z.string().min(1).max(80) }),
  async handler(ctx, { eventId, key }) {
    const rows = await ctx.db
      .delete(sysOutbox)
      .where(and(eq(sysOutbox.eventId, eventId), eq(sysOutbox.status, "pending"), sql`${sysOutbox.meta}->>'campaign' = ${key}`, gt(sysOutbox.nextAttemptAt, new Date())))
      .returning({ id: sysOutbox.id });
    return { stopped: rows.length };
  },
});
