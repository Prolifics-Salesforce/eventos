import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { sysProperty } from "@/db/schema";

export async function getProperty(db: Db, key: string): Promise<string | null> {
  const [row] = await db.select().from(sysProperty).where(eq(sysProperty.key, key));
  return row?.value ?? null;
}

/** Record that something has happened. Returns true the first time only, so a job can run exactly once. */
export async function markOnce(db: Db, key: string, value = "1"): Promise<boolean> {
  const rows = await db.insert(sysProperty).values({ key, value }).onConflictDoNothing().returning({ key: sysProperty.key });
  return rows.length === 1;
}

let secret: string | undefined;
/** The instance's signing secret: APP_SECRET when set, otherwise generated once and kept in the database. */
async function instanceSecret(db: Db): Promise<string> {
  if (secret) return secret;
  if (process.env.APP_SECRET) return (secret = process.env.APP_SECRET);
  await markOnce(db, "instance.secret", randomBytes(32).toString("base64url"));
  return (secret = (await getProperty(db, "instance.secret"))!);
}

const sign = (key: string, value: string) => createHmac("sha256", key).update(value).digest("base64url").slice(0, 32);

/** A link token that proves the holder was sent it, e.g. an unsubscribe link. Does not expire. */
export async function signedToken(db: Db, purpose: string, id: string): Promise<string> {
  return `${id}.${sign(await instanceSecret(db), `${purpose}:${id}`)}`;
}

/** The id inside a token, or null when the token was not issued by this instance for this purpose. */
export async function readToken(db: Db, purpose: string, token: string): Promise<string | null> {
  const [id, mac] = token.split(".");
  if (!id || !mac) return null;
  const expected = Buffer.from(sign(await instanceSecret(db), `${purpose}:${id}`));
  const given = Buffer.from(mac);
  return given.length === expected.length && timingSafeEqual(given, expected) ? id : null;
}

export const appUrl = () => (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
