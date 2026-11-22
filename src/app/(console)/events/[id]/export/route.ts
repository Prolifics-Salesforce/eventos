import "@/tools";
import { getDb } from "@/db/client";
import { currentPrincipal } from "@/lib/session";
import { invoke } from "@/platform/tools";

export const dynamic = "force-dynamic";

/** Quote a cell, and defuse values a spreadsheet would run as a formula. */
const cell = (value: unknown) => {
  let s = value instanceof Date ? value.toISOString() : value && typeof value === "object" ? JSON.stringify(value) : String(value ?? "");
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
};

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const principal = await currentPrincipal();
  if (!principal) return new Response("Sign in to export.", { status: 401 });
  const result = await invoke<{ rows: Record<string, unknown>[] }>(await getDb(), principal, "registration.export", { eventId: (await params).id });
  if (result.status !== "ok") return new Response("You cannot export this event.", { status: result.status === "denied" ? 403 : 400 });
  const columns = ["number", "status", "source", "checkedInAt", "firstName", "lastName", "email", "phone", "title", "answers"];
  const csv = [columns.join(","), ...result.output.rows.map((r) => columns.map((c) => cell(r[c])).join(","))].join("\r\n");
  return new Response(csv, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": 'attachment; filename="registrations.csv"', "cache-control": "no-store" } });
}
