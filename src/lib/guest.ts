import { cache } from "react";
import { cookies } from "next/headers";
import { eq } from "drizzle-orm";
import { getDb, type Db } from "@/db/client";
import { contact } from "@/db/schema";
import { readToken, signedToken } from "@/platform/properties";

export const GUEST_COOKIE = "eventos_guest";
const DAYS = 30;
export const GUEST_MAX_AGE = DAYS * 86_400;

/**
 * What a signed-in guest's cookie holds: who they are and until when, signed
 * with the instance's secret so it cannot be made up or altered. Nothing is
 * stored on the server; a guest has no password to keep.
 */
export async function guestCookieValue(db: Db, contactId: string, now = Date.now()): Promise<string> {
  return signedToken(db, "guest", `${contactId}~${now + DAYS * 86_400_000}`);
}

/** The contact a cookie value stands for, or null when it is forged, altered or past its date. */
export async function readGuestCookie(db: Db, value: string, now = Date.now()): Promise<string | null> {
  const signed = await readToken(db, "guest", value);
  if (!signed) return null;
  const [contactId, until] = signed.split("~");
  return contactId && Number(until) > now ? contactId : null;
}

/** The guest who is signed in on this browser, looked up once per request. A guest who has been erased is signed out. */
export const currentGuest = cache(async () => {
  const value = (await cookies()).get(GUEST_COOKIE)?.value;
  if (!value) return null;
  const db = await getDb();
  const contactId = await readGuestCookie(db, value);
  if (!contactId) return null;
  const [who] = await db.select().from(contact).where(eq(contact.id, contactId));
  return who ?? null;
});
