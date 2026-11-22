import { randomBytes } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { getDb } from "../src/db/client";
import { sysUser } from "../src/db/schema";
import { setPassword } from "../src/platform/auth";
import { createApiKey } from "../src/platform/principal";
import { createUser, DEFAULT_AGENTS, ensurePlatform } from "../src/platform/seed";

const db = await getDb();
await ensurePlatform(db);

const email = (process.env.ADMIN_EMAIL ?? "admin@example.com").toLowerCase();
let [admin] = await db.select().from(sysUser).where(eq(sysUser.email, email));
if (!admin) {
  const id = await createUser(db, { name: process.env.ADMIN_NAME ?? "Admin", kind: "human", email, roles: ["admin"] });
  [admin] = await db.select().from(sysUser).where(eq(sysUser.id, id));
  console.log(`Created admin ${email}.`);
  console.log(`API key (shown once, store it safely): ${await createApiKey(db, id, "seed")}`);
}
for (const agent of DEFAULT_AGENTS) {
  const [found] = await db.select().from(sysUser).where(and(eq(sysUser.name, agent.name), eq(sysUser.kind, "agent")));
  if (!found) await createUser(db, agent);
}
if (!admin.passwordHash) {
  const password = process.env.ADMIN_PASSWORD ?? randomBytes(12).toString("base64url");
  await setPassword(db, admin.id, password);
  console.log(`Sign in at http://localhost:3000 as ${email}`);
  console.log(process.env.ADMIN_PASSWORD ? "Password: the ADMIN_PASSWORD you set." : `Password (shown once): ${password}`);
} else {
  console.log("Platform accounts are up to date.");
}
process.exit(0);
