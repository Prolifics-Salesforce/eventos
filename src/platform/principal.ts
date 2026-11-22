import { createHash, randomBytes } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import type { Db } from "@/db/client";
import { sysApiKey, sysRole, sysUser, sysUserRole, type PrincipalKind } from "@/db/schema";

/** Whoever is acting: a person, an agent or a service account. */
export type Principal = { id: string; kind: PrincipalKind; name: string; permissions: ReadonlySet<string> };

/** Permissions are resolved from the database on every load, so a revocation is immediate. */
export async function loadPrincipal(db: Db, userId: string): Promise<Principal | null> {
  const [user] = await db.select().from(sysUser).where(eq(sysUser.id, userId));
  if (!user || !user.active) return null;
  const roles = await db
    .select({ permissions: sysRole.permissions })
    .from(sysUserRole)
    .innerJoin(sysRole, eq(sysRole.id, sysUserRole.roleId))
    .where(eq(sysUserRole.userId, userId));
  return { id: user.id, kind: user.kind, name: user.name, permissions: new Set(roles.flatMap((r) => r.permissions)) };
}

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

/** Returns the key once. Only its hash is stored. */
export async function createApiKey(db: Db, userId: string, name: string): Promise<string> {
  const key = `evk_${randomBytes(32).toString("base64url")}`;
  await db.insert(sysApiKey).values({ userId, name, hash: sha256(key) });
  return key;
}

export async function principalForApiKey(db: Db, key: string): Promise<Principal | null> {
  const [row] = await db
    .select({ userId: sysApiKey.userId })
    .from(sysApiKey)
    .where(and(eq(sysApiKey.hash, sha256(key)), isNull(sysApiKey.revokedAt)));
  return row ? loadPrincipal(db, row.userId) : null;
}
