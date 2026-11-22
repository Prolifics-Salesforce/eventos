import { and, eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { sysRole, sysUser, sysUserRole, type PrincipalKind } from "@/db/schema";
import { DEFAULT_ROLES } from "./permissions";
import { loadPrincipal, type Principal } from "./principal";

/** Create or refresh the default roles. Safe to run on every start. */
export async function seedRoles(db: Db): Promise<void> {
  for (const [name, permissions] of Object.entries(DEFAULT_ROLES)) {
    await db.insert(sysRole).values({ name, permissions }).onConflictDoUpdate({ target: sysRole.name, set: { permissions } });
  }
}

export async function createUser(
  db: Db, user: { name: string; kind: PrincipalKind; email?: string; roles: string[] },
): Promise<string> {
  const [row] = await db.insert(sysUser).values({ name: user.name, kind: user.kind, email: user.email }).returning({ id: sysUser.id });
  for (const roleName of user.roles) {
    const [role] = await db.select({ id: sysRole.id }).from(sysRole).where(eq(sysRole.name, roleName));
    if (!role) throw new Error(`Unknown role ${roleName}`);
    await db.insert(sysUserRole).values({ userId: row.id, roleId: role.id });
  }
  return row.id;
}

export const SERVICE_ACCOUNTS = [
  { name: "Public site", kind: "service" as const, roles: ["public_site"] },
  { name: "System", kind: "service" as const, roles: ["system"] },
];

/** Roles and service accounts every instance needs. Safe to run on every start. */
export async function ensurePlatform(db: Db): Promise<void> {
  await seedRoles(db);
  for (const account of SERVICE_ACCOUNTS) {
    const [found] = await db.select({ id: sysUser.id }).from(sysUser).where(and(eq(sysUser.name, account.name), eq(sysUser.kind, "service")));
    if (!found) await createUser(db, account);
  }
  for (const agent of DEFAULT_AGENTS) {
    const [found] = await db.select({ id: sysUser.id }).from(sysUser).where(and(eq(sysUser.name, agent.name), eq(sysUser.kind, "agent")));
    if (!found) await createUser(db, agent);
  }
}

const serviceIds = new Map<string, string>();
/** The principal for a built-in service account, with permissions read fresh. */
export async function servicePrincipal(db: Db, name: "Public site" | "System" | "Concierge"): Promise<Principal> {
  let id = serviceIds.get(name);
  if (!id) {
    const [row] = await db.select({ id: sysUser.id }).from(sysUser).where(and(eq(sysUser.name, name), eq(sysUser.kind, name === "Concierge" ? "agent" : "service")));
    if (!row) throw new Error(`Service account ${name} is missing; run ensurePlatform`);
    serviceIds.set(name, (id = row.id));
  }
  const principal = await loadPrincipal(db, id);
  if (!principal) throw new Error(`Service account ${name} is inactive`);
  return principal;
}

/** The agents. They are ordinary accounts with roles, so policies can be set for each. */
export const DEFAULT_AGENTS = [
  { name: "Builder", kind: "agent" as const, roles: ["agent_builder"] },
  { name: "Lead Intelligence", kind: "agent" as const, roles: ["agent_lead"] },
  { name: "Analyst", kind: "agent" as const, roles: ["agent_analyst"] },
  { name: "Outreach", kind: "agent" as const, roles: ["agent_outreach"] },
  { name: "Concierge", kind: "agent" as const, roles: ["agent_concierge"] },
];
