import { getDb } from "../src/db/client";

await getDb(); // opening the database applies pending migrations
console.log("Database is up to date.");
process.exit(0);
