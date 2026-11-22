import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import * as schema from "./schema";

/** Works for a connection and for a transaction, on either driver. */
export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

const MIGRATIONS = process.env.MIGRATIONS_DIR ?? "./drizzle";

/**
 * Open the instance's database and bring it up to date.
 * With `url` it is a real Postgres; without, an embedded one (a folder, or
 * memory when `dir` is omitted) so development and tests need no install.
 */
export async function openDb(opts: { url?: string; dir?: string } = {}): Promise<Db> {
  if (opts.url) {
    const { drizzle } = await import("drizzle-orm/node-postgres");
    const { migrate } = await import("drizzle-orm/node-postgres/migrator");
    const db = drizzle(opts.url, { schema });
    await migrate(db, { migrationsFolder: MIGRATIONS });
    return db as unknown as Db;
  }
  if (opts.dir) (await import("node:fs")).mkdirSync(opts.dir, { recursive: true });
  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  const { migrate } = await import("drizzle-orm/pglite/migrator");
  const db = drizzle(new PGlite(opts.dir), { schema });
  await migrate(db, { migrationsFolder: MIGRATIONS });
  return db as unknown as Db;
}

const holder = globalThis as unknown as { __eventosDb?: Promise<Db> };

/** The process-wide connection. Cached on globalThis so dev reloads reuse it. */
export function getDb(): Promise<Db> {
  holder.__eventosDb ??= openDb(
    process.env.DATABASE_URL ? { url: process.env.DATABASE_URL } : { dir: process.env.PGLITE_DIR ?? "./.data/pg" },
  );
  return holder.__eventosDb;
}

export { schema };
