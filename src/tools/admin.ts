import { and, count, eq, isNull, ne } from "drizzle-orm";
import { z } from "zod";
import { randomBytes } from "node:crypto";
import { sysPolicy, sysProperty, sysRole, sysSession, sysUser, sysUserRole, webhook } from "@/db/schema";
import { hashPassword, verifyPassword } from "@/platform/auth";
import { HUMAN_ROLES } from "@/platform/permissions";
import { createUser } from "@/platform/seed";
import { defineTool, getTool, ToolError } from "@/platform/tools";

export const userCreate = defineTool({
  name: "user.create",
  description: "Add a person to the team with a role and a starting password.",
  permission: "admin.manage",
  risk: "write",
  redact: ["password"],
  input: z.object({
    name: z.string().trim().min(2).max(80),
    email: z.email().transform((e) => e.trim().toLowerCase()),
    role: z.enum(HUMAN_ROLES),
    password: z.string().min(10).max(200),
  }),
  async handler(ctx, { name, email, role, password }) {
    const [taken] = await ctx.db.select({ id: sysUser.id }).from(sysUser).where(eq(sysUser.email, email));
    if (taken) throw new ToolError("exists", "Someone with that email is already on the team");
    const id = await createUser(ctx.db, { name, email, kind: "human", roles: [role] });
    await ctx.db.update(sysUser).set({ passwordHash: hashPassword(password) }).where(eq(sysUser.id, id));
    return { id, email, role };
  },
});

export const policySet = defineTool({
  name: "policy.set",
  description: "Set the autonomy dial for one agent on one tool: suggest, approve, or auto with an optional daily cap.",
  permission: "admin.manage",
  risk: "write",
  input: z.object({
    agentId: z.uuid().optional().describe("Omit to set the default for every agent"),
    tool: z.string().min(1).max(80),
    level: z.enum(["suggest", "approve", "auto"]),
    dailyCap: z.number().int().positive().max(100000).optional(),
  }),
  async handler(ctx, { agentId, tool, level, dailyCap }) {
    if (tool !== "*" && !getTool(tool)) throw new ToolError("not_found", `No tool named ${tool}`);
    if (agentId) {
      const [who] = await ctx.db.select({ kind: sysUser.kind }).from(sysUser).where(eq(sysUser.id, agentId));
      if (who?.kind !== "agent") throw new ToolError("not_agent", "Policies apply to agents only");
    }
    const match = and(agentId ? eq(sysPolicy.userId, agentId) : isNull(sysPolicy.userId), eq(sysPolicy.tool, tool));
    const values = { level, dailyCap: level === "auto" ? (dailyCap ?? null) : null };
    const [existing] = await ctx.db.select({ id: sysPolicy.id }).from(sysPolicy).where(match);
    if (existing) await ctx.db.update(sysPolicy).set(values).where(eq(sysPolicy.id, existing.id));
    else await ctx.db.insert(sysPolicy).values({ userId: agentId ?? null, tool, ...values });
    return { tool, ...values };
  },
});

export const userSetPassword = defineTool({
  name: "user.set_password",
  description: "Give a team member a new password and sign them out everywhere.",
  permission: "admin.manage",
  risk: "write",
  redact: ["password"],
  input: z.object({ userId: z.uuid(), password: z.string().min(10).max(200) }),
  async handler(ctx, { userId, password }) {
    const [who] = await ctx.db.select({ kind: sysUser.kind }).from(sysUser).where(eq(sysUser.id, userId));
    if (who?.kind !== "human") throw new ToolError("not_found", "No such person");
    await ctx.db.update(sysUser).set({ passwordHash: hashPassword(password) }).where(eq(sysUser.id, userId));
    await ctx.db.delete(sysSession).where(eq(sysSession.userId, userId));
    return { reset: true };
  },
});

export const accountChangePassword = defineTool({
  name: "account.change_password",
  description: "Change your own password. Needs the current one.",
  permission: "account.self",
  risk: "write",
  redact: ["current", "password"],
  input: z.object({ current: z.string().max(200), password: z.string().min(10).max(200) }),
  async handler(ctx, { current, password }) {
    const [me] = await ctx.db.select().from(sysUser).where(eq(sysUser.id, ctx.principal.id));
    if (!me || me.kind !== "human" || !verifyPassword(current, me.passwordHash)) throw new ToolError("wrong_password", "The current password is not right");
    await ctx.db.update(sysUser).set({ passwordHash: hashPassword(password) }).where(eq(sysUser.id, me.id));
    return { changed: true };
  },
});

export const webhookCreate = defineTool({
  name: "webhook.create",
  description: "Tell another system when things happen here. Give its address and which events it wants (for example registration.created, checkin.confirmed, lead.captured), or * for all.",
  permission: "admin.manage",
  risk: "write",
  redact: ["secret"],
  input: z.object({
    url: z.url().refine((u) => u.startsWith("https://") || /^http:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(u), "Use an https address"),
    events: z.array(z.string().regex(/^(\*|[a-z_]+\.[a-z_]+)$/)).min(1).max(40),
  }),
  async handler(ctx, { url, events }) {
    const secret = `whsec_${randomBytes(24).toString("base64url")}`;
    const [row] = await ctx.db.insert(webhook).values({ url, events, secret, createdBy: ctx.principal.id, updatedBy: ctx.principal.id }).returning({ id: webhook.id });
    // The secret is returned once, here, and is kept out of the ledger by the route that shows it.
    return { id: row.id, secret };
  },
});

export const webhookRemove = defineTool({
  name: "webhook.remove",
  description: "Stop telling another system about events here.",
  permission: "admin.manage",
  risk: "write",
  input: z.object({ webhookId: z.uuid() }),
  async handler(ctx, { webhookId }) {
    const rows = await ctx.db.delete(webhook).where(eq(webhook.id, webhookId)).returning({ id: webhook.id });
    if (rows.length === 0) throw new ToolError("not_found", "No such connection");
    return { removed: true };
  },
});

export const playbookSet = defineTool({
  name: "playbook.set",
  description: "Set the organisation's playbook: brand voice, naming rules, compliance and approval policies. Every agent reads it before it works.",
  permission: "admin.manage",
  risk: "write",
  input: z.object({ text: z.string().max(12000) }),
  async handler(ctx, { text }) {
    await ctx.db.insert(sysProperty).values({ key: "playbook", value: text }).onConflictDoUpdate({ target: sysProperty.key, set: { value: text } });
    return { saved: true, length: text.length };
  },
});

/** How many active people other than `userId` are administrators. An instance must always have one. */
async function otherAdmins(db: Parameters<typeof userCreate.handler>[0]["db"], userId: string): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(sysUserRole)
    .innerJoin(sysRole, eq(sysRole.id, sysUserRole.roleId))
    .innerJoin(sysUser, eq(sysUser.id, sysUserRole.userId))
    .where(and(eq(sysRole.name, "admin"), eq(sysUser.kind, "human"), eq(sysUser.active, true), ne(sysUser.id, userId)));
  return row.n;
}

export const userSetRole = defineTool({
  name: "user.set_role",
  description: "Change a team member's role. It takes effect on their next page.",
  permission: "admin.manage",
  risk: "write",
  input: z.object({ userId: z.uuid(), role: z.enum(HUMAN_ROLES) }),
  async handler(ctx, { userId, role }) {
    const [who] = await ctx.db.select({ kind: sysUser.kind }).from(sysUser).where(eq(sysUser.id, userId));
    if (who?.kind !== "human") throw new ToolError("not_found", "No such person");
    if (role !== "admin" && (await otherAdmins(ctx.db, userId)) === 0) throw new ToolError("last_admin", "This is the only administrator. Make someone else an administrator first.");
    const [target] = await ctx.db.select({ id: sysRole.id }).from(sysRole).where(eq(sysRole.name, role));
    if (!target) throw new ToolError("not_found", `No role called ${role}`);
    await ctx.db.delete(sysUserRole).where(eq(sysUserRole.userId, userId));
    await ctx.db.insert(sysUserRole).values({ userId, roleId: target.id });
    return { userId, role };
  },
});

export const userSetActive = defineTool({
  name: "user.set_active",
  description: "Switch a team member's account off or back on. Switching it off signs them out everywhere; nothing they did is removed.",
  permission: "admin.manage",
  risk: "write",
  input: z.object({ userId: z.uuid(), active: z.boolean() }),
  async handler(ctx, { userId, active }) {
    const [who] = await ctx.db.select({ kind: sysUser.kind }).from(sysUser).where(eq(sysUser.id, userId));
    if (who?.kind !== "human") throw new ToolError("not_found", "No such person");
    if (!active) {
      if (userId === ctx.principal.id) throw new ToolError("self", "You cannot switch off your own account");
      if ((await otherAdmins(ctx.db, userId)) === 0) throw new ToolError("last_admin", "This is the only administrator. Make someone else an administrator first.");
      await ctx.db.delete(sysSession).where(eq(sysSession.userId, userId));
    }
    await ctx.db.update(sysUser).set({ active }).where(eq(sysUser.id, userId));
    return { userId, active };
  },
});
