import "@/tools";
import { getDb } from "@/db/client";
import { currentPrincipal } from "@/lib/session";
import { invoke } from "@/platform/tools";

export const dynamic = "force-dynamic";

/** Download everything held about one person. A POST, so the email never sits in an address bar or a server log. */
export async function POST(request: Request) {
  const principal = await currentPrincipal();
  if (!principal) return new Response("Sign in to export.", { status: 401 });
  const email = String((await request.formData()).get("email") ?? "");
  const result = await invoke(await getDb(), principal, "contact.export", { email });
  if (result.status !== "ok") {
    const reason = result.status === "denied" ? "Only an administrator can export a person's data." : result.status === "error" ? result.message : "Enter a valid email address.";
    return Response.redirect(new URL(`/settings?notice=${encodeURIComponent(reason)}`, request.url), 303);
  }
  return new Response(JSON.stringify(result.output, null, 2), {
    headers: { "content-type": "application/json; charset=utf-8", "content-disposition": 'attachment; filename="person-data.json"', "cache-control": "no-store" },
  });
}
