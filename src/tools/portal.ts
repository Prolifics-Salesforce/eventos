/**
 * A guest's way in to their own events. Guests have no password: they ask for
 * a link by email, and the link is the proof that the mailbox is theirs.
 * Both tools run as the Public site account, since nobody is signed in yet.
 */
import { createHash, randomBytes } from "node:crypto";
import { and, eq, like, sql } from "drizzle-orm";
import { z } from "zod";
import { contact, registration, sysProperty } from "@/db/schema";
import { appUrl } from "@/platform/properties";
import { defineTool, ToolError } from "@/platform/tools";

const LINK_MINUTES = 30;
const linkKey = (token: string) => `guestlink:${createHash("sha256").update(token).digest("hex")}`;

export const guestRequestLink = defineTool({
  name: "guest.request_link",
  description: "Email a guest a link to see every event they are registered for, with their passes. Says the same whether or not the email is on any guest list, so it cannot be used to find out who is attending.",
  permission: "guest.portal",
  risk: "write",
  redact: ["email"],
  input: z.object({ email: z.string().trim().toLowerCase().max(200) }),
  async handler(ctx, { email }) {
    const [who] = await ctx.db.select().from(contact).where(eq(contact.email, email));
    const [any] = who ? await ctx.db.select({ id: registration.id }).from(registration).where(eq(registration.contactId, who.id)).limit(1) : [];
    if (who && any) {
      // A new link replaces any earlier one for the same person.
      await ctx.db.delete(sysProperty).where(and(like(sysProperty.key, "guestlink:%"), sql`${sysProperty.value}::jsonb->>'contactId' = ${who.id}`));
      const token = randomBytes(32).toString("base64url");
      await ctx.db.insert(sysProperty).values({ key: linkKey(token), value: JSON.stringify({ contactId: who.id, until: Date.now() + LINK_MINUTES * 60_000 }) });
      // Sent even to someone who has unsubscribed: they asked for this one themselves, just now.
      await ctx.enqueue({
        channel: "email", recipient: who.email, subject: "Your events and passes", contactId: who.id,
        body: [`Hi ${who.firstName},`, "", "Open this link to see the events you are registered for and your passes:", `${appUrl()}/my/enter/${token}`, "", `The link works once, for ${LINK_MINUTES} minutes. If you did not ask for it, ignore this email.`].join("\n"),
      });
    }
    return { sent: true };
  },
});

export const guestSignIn = defineTool({
  name: "guest.sign_in",
  description: "Use the link from a guest's sign-in email. The link works once.",
  permission: "guest.portal",
  risk: "write",
  redact: ["token"],
  input: z.object({ token: z.string().min(20).max(200) }),
  async handler(ctx, { token }) {
    const [row] = await ctx.db.delete(sysProperty).where(eq(sysProperty.key, linkKey(token))).returning({ value: sysProperty.value });
    const claim = row ? (JSON.parse(row.value) as { contactId: string; until: number }) : null;
    if (!claim || claim.until < Date.now()) throw new ToolError("bad_link", "That link has expired or was already used. Ask for a new one.");
    const [who] = await ctx.db.select({ id: contact.id }).from(contact).where(eq(contact.id, claim.contactId));
    if (!who) throw new ToolError("bad_link", "That link has expired or was already used. Ask for a new one.");
    return { contactId: who.id };
  },
});
