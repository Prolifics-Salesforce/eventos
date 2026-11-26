import { timingSafeEqual } from "node:crypto";
import { getDb } from "@/db/client";
import { tick } from "@/platform/tick";
import { wire } from "@/platform/wiring";

export const dynamic = "force-dynamic";
/** Sending a large campaign or carrying out an agent run can take minutes. */
export const maxDuration = 300;

/**
 * The background work, one pass per call. A scheduler calls this every minute
 * with `Authorization: Bearer <CRON_SECRET>`; Vercel Cron sends that header
 * itself when CRON_SECRET is set.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return Response.json({ error: "CRON_SECRET is not set" }, { status: 503 });
  const given = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return Response.json({ error: "unauthorized" }, { status: 401 });
  try {
    await wire();
    return Response.json(await tick(await getDb()));
  } catch (error) {
    console.error("[tick]", error);
    return Response.json({ error: "tick failed" }, { status: 500 });
  }
}
