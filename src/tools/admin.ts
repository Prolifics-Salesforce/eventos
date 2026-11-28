import { and, count, eq, isNull, like, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { createHash, randomBytes } from "node:crypto";
import { sysApiKey, sysPolicy, sysProperty, sysRole, sysSession, sysUser, sysUserRole, webhook } from "@/db/schema";
import { createApiKey } from "@/platform/principal";
import { emailIsSetUp } from "./portal";
import { hashPassword, verifyPassword } from "@/platform/auth";
import { HUMAN_ROLES } from "@/platform/permissions";
import { appUrl } from "@/platform/properties";
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

const RESET_MINUTES = 60;
const resetKey = (token: string) => `reset:${createHash("sha256").update(token).digest("hex")}`;

export const accountRequestReset = defineTool({
  name: "account.request_reset",
  description: "Email a team member a link to choose a new password. Says the same whether or not the email belongs to anyone, so it cannot be used to find out who is on the team.",
  permission: "account.reset",
  risk: "write",
  redact: ["email"],
  input: z.object({ email: z.string().trim().toLowerCase().max(200) }),
  async handler(ctx, { email }) {
    const [who] = await ctx.db.select().from(sysUser).where(and(eq(sysUser.email, email), eq(sysUser.kind, "human"), eq(sysUser.active, true)));
    if (who) {
      // A new link replaces any earlier one for the same person.
      await ctx.db.delete(sysProperty).where(and(like(sysProperty.key, "reset:%"), sql`${sysProperty.value}::jsonb->>'userId' = ${who.id}`));
      const token = randomBytes(32).toString("base64url");
      await ctx.db.insert(sysProperty).values({ key: resetKey(token), value: JSON.stringify({ userId: who.id, until: Date.now() + RESET_MINUTES * 60_000 }) });
      await ctx.enqueue({
        channel: "email", recipient: who.email!, subject: "Choose a new password",
        body: [`Hi ${who.name.split(" ")[0]},`, "", "Someone asked to reset the password for your account. If it was you, choose a new one here:", `${appUrl()}/reset/${token}`, "", `The link works once, for ${RESET_MINUTES} minutes. If it was not you, ignore this email and nothing changes.`].join("\n"),
      });
    }
    return { sent: true };
  },
});

export const accountResetPassword = defineTool({
  name: "account.reset_password",
  description: "Set a new password using the link from a reset email. The link works once; using it signs the person out everywhere.",
  permission: "account.reset",
  risk: "write",
  redact: ["token", "password"],
  input: z.object({ token: z.string().min(20).max(200), password: z.string().min(10).max(200) }),
  async handler(ctx, { token, password }) {
    const [row] = await ctx.db.delete(sysProperty).where(eq(sysProperty.key, resetKey(token))).returning({ value: sysProperty.value });
    const claim = row ? (JSON.parse(row.value) as { userId: string; until: number }) : null;
    if (!claim || claim.until < Date.now()) throw new ToolError("bad_link", "That link has expired or was already used. Ask for a new one.");
    const [who] = await ctx.db.select({ id: sysUser.id }).from(sysUser).where(and(eq(sysUser.id, claim.userId), eq(sysUser.kind, "human"), eq(sysUser.active, true)));
    if (!who) throw new ToolError("bad_link", "That link has expired or was already used. Ask for a new one.");
    await ctx.db.update(sysUser).set({ passwordHash: hashPassword(password) }).where(eq(sysUser.id, who.id));
    await ctx.db.delete(sysSession).where(eq(sysSession.userId, who.id));
    return { reset: true };
  },
});

const INVITE_DAYS = 7;

export const userInvite = defineTool({
  name: "user.invite",
  description: "Add a person to the team and email them a link to choose their own password, so nobody else ever knows it. On a site with no mail server, the link is returned to be passed on by hand.",
  permission: "admin.manage",
  risk: "write",
  redact: ["link"],
  input: z.object({ name: z.string().trim().min(2).max(80), email: z.string().trim().toLowerCase().pipe(z.email()), role: z.enum(HUMAN_ROLES) }),
  async handler(ctx, { name, email, role }): Promise<{ id: string; email: string; role: string; link?: string }> {
    const [taken] = await ctx.db.select({ id: sysUser.id }).from(sysUser).where(eq(sysUser.email, email));
    if (taken) throw new ToolError("exists", "Someone with that email is already on the team");
    const id = await createUser(ctx.db, { name, email, kind: "human", roles: [role] });
    const token = randomBytes(32).toString("base64url");
    await ctx.db.insert(sysProperty).values({ key: resetKey(token), value: JSON.stringify({ userId: id, until: Date.now() + INVITE_DAYS * 86_400_000 }) });
    const link = `${appUrl()}/reset/${token}`;
    await ctx.enqueue({
      channel: "email", recipient: email, subject: "You have been added to the events team",
      body: [`Hi ${name.split(" ")[0]},`, "", `${ctx.principal.name} has added you to the events team as ${/^[aeiou]/.test(role) ? "an" : "a"} ${role}.`, "Choose your password to get started:", link, "", `The link works once, for ${INVITE_DAYS} days.`].join("\n"),
    });
    return { id, email, role, ...(emailIsSetUp() ? {} : { link }) };
  },
});

export const userSetEmail = defineTool({
  name: "user.set_email",
  description: "Change the email a team member signs in with. Their password stays the same.",
  permission: "admin.manage",
  risk: "write",
  input: z.object({ userId: z.uuid(), email: z.string().trim().toLowerCase().pipe(z.email()) }),
  async handler(ctx, { userId, email }) {
    const [who] = await ctx.db.select({ kind: sysUser.kind }).from(sysUser).where(eq(sysUser.id, userId));
    if (who?.kind !== "human") throw new ToolError("not_found", "No such person");
    const [taken] = await ctx.db.select({ id: sysUser.id }).from(sysUser).where(and(eq(sysUser.email, email), ne(sysUser.id, userId)));
    if (taken) throw new ToolError("exists", "Someone else on the team already uses that email");
    await ctx.db.update(sysUser).set({ email }).where(eq(sysUser.id, userId));
    return { userId, email };
  },
});

export const apiKeyCreate = defineTool({
  name: "apikey.create",
  description: "Create a key that lets another program act as a team member, with that person's role. The key is shown once and cannot be read again.",
  permission: "admin.manage",
  risk: "write",
  redact: ["key"],
  input: z.object({ name: z.string().trim().min(2).max(80), userId: z.uuid().optional().describe("Whose role the key carries. Leave out for your own") }),
  async handler(ctx, { name, userId }) {
    const owner = userId ?? ctx.principal.id;
    const [who] = await ctx.db.select({ kind: sysUser.kind, active: sysUser.active }).from(sysUser).where(eq(sysUser.id, owner));
    if (!who || who.kind !== "human" || !who.active) throw new ToolError("not_found", "No such active person");
    const key = await createApiKey(ctx.db, owner, name);
    return { key, name };
  },
});

export const apiKeyRevoke = defineTool({
  name: "apikey.revoke",
  description: "Stop a key working, at once and for good.",
  permission: "admin.manage",
  risk: "write",
  input: z.object({ keyId: z.uuid() }),
  async handler(ctx, { keyId }) {
    const rows = await ctx.db.update(sysApiKey).set({ revokedAt: new Date() }).where(and(eq(sysApiKey.id, keyId), isNull(sysApiKey.revokedAt))).returning({ id: sysApiKey.id });
    if (rows.length === 0) throw new ToolError("not_found", "No such working key");
    return { revoked: true };
  },
});
