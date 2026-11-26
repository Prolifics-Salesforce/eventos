import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { and, eq, gt, lt } from "drizzle-orm";
import type { Db } from "@/db/client";
import { sysRole, sysSession, sysUser, sysUserRole } from "@/db/schema";
import type { Principal } from "./principal";

const SESSION_DAYS = 14;
const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  return `scrypt$${salt.toString("base64")}$${scryptSync(password, salt, 64).toString("base64")}`;
}

export function verifyPassword(password: string, stored: string | null): boolean {
  // Always do the work, so a wrong email and a wrong password take the same time.
  const [, salt, hash] = (stored ?? `scrypt$${"A".repeat(22)}==$${"A".repeat(86)}==`).split("$");
  const expected = Buffer.from(hash, "base64");
  const actual = scryptSync(password, Buffer.from(salt, "base64"), expected.length);
  return stored !== null && timingSafeEqual(actual, expected);
}

export async function setPassword(db: Db, userId: string, password: string): Promise<void> {
  if (password.length < 10) throw new Error("Password must be at least 10 characters");
  await db.update(sysUser).set({ passwordHash: hashPassword(password) }).where(eq(sysUser.id, userId));
}

/** Returns a session token for the cookie, or null. Never says which of email or password was wrong. */
export async function signIn(db: Db, email: string, password: string): Promise<string | null> {
  const [user] = await db
    .select()
    .from(sysUser)
    .where(and(eq(sysUser.email, email.trim().toLowerCase()), eq(sysUser.kind, "human"), eq(sysUser.active, true)));
  if (!verifyPassword(password, user?.passwordHash ?? null) || !user) return null;
  const token = randomBytes(32).toString("base64url");
  await db.delete(sysSession).where(lt(sysSession.expiresAt, new Date()));
  await db.insert(sysSession).values({ userId: user.id, tokenHash: sha256(token), expiresAt: new Date(Date.now() + SESSION_DAYS * 86_400_000) });
  return token;
}

export async function principalForSession(db: Db, token: string): Promise<Principal | null> {
  // Runs on every page, so the person and their roles are read together, in one trip to the database.
  const valid = and(eq(sysSession.tokenHash, sha256(token)), gt(sysSession.expiresAt, new Date()));
  const [[user], roles] = await Promise.all([
    db.select({ id: sysUser.id, kind: sysUser.kind, name: sysUser.name, active: sysUser.active }).from(sysSession).innerJoin(sysUser, eq(sysUser.id, sysSession.userId)).where(valid),
    db.select({ permissions: sysRole.permissions }).from(sysSession).innerJoin(sysUserRole, eq(sysUserRole.userId, sysSession.userId)).innerJoin(sysRole, eq(sysRole.id, sysUserRole.roleId)).where(valid),
  ]);
  if (!user || !user.active) return null;
  return { id: user.id, kind: user.kind, name: user.name, permissions: new Set(roles.flatMap((r) => r.permissions)) };
}

export async function signOut(db: Db, token: string): Promise<void> {
  await db.delete(sysSession).where(eq(sysSession.tokenHash, sha256(token)));
}

export const SESSION_MAX_AGE = SESSION_DAYS * 86_400;
