import "@/tools";
import { getDb } from "@/db/client";
import { principalForApiKey } from "@/platform/principal";
import { invoke } from "@/platform/tools";

export const dynamic = "force-dynamic";

const HTTP: Record<string, number> = { ok: 200, pending_approval: 202, denied: 403, invalid: 400, error: 422 };

/** Call a tool. `Authorization: Bearer <api key>`; the JSON body is the tool's input. */
export async function POST(request: Request, { params }: { params: Promise<{ name: string }> }) {
  const key = request.headers.get("authorization")?.match(/^Bearer (.+)$/)?.[1];
  if (!key) return Response.json({ status: "denied", reason: "Missing API key" }, { status: 401 });
  const db = await getDb();
  const principal = await principalForApiKey(db, key);
  if (!principal) return Response.json({ status: "denied", reason: "Unknown or revoked API key" }, { status: 401 });

  const input = await request.json().catch(() => ({}));
  const result = await invoke(db, principal, (await params).name, input);
  const status = result.status === "error" && result.code === "unknown_tool" ? 404 : HTTP[result.status];
  return Response.json(result, { status });
}
