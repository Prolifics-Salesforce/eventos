import { sql } from "drizzle-orm";
import { getDb } from "@/db/client";

export const dynamic = "force-dynamic";

/** For a load balancer or an uptime monitor: 200 when the app can reach its database, 503 when it cannot. */
export async function GET() {
  try {
    await (await getDb()).execute(sql`select 1`);
    return Response.json({ ok: true }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    console.error("[health]", error);
    return Response.json({ ok: false }, { status: 503, headers: { "cache-control": "no-store" } });
  }
}
