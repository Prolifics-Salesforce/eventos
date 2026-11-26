import { getDb } from "../src/db/client";
import { ensurePlatform } from "../src/platform/seed";

// Bring the database up to date and make sure the roles, service accounts and agents exist.
// Run by hand with `npm run db:migrate`, and by the build on Vercel (`vercel-build`).
process.env.EVENTOS_MIGRATE = "1";
const db = await getDb(); // opening the database applies pending migrations
await ensurePlatform(db);
console.log("Database is up to date.");
process.exit(0);
