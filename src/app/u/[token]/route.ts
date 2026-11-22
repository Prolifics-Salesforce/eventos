import "@/tools";
import { getDb } from "@/db/client";
import { readToken } from "@/platform/properties";
import { servicePrincipal } from "@/platform/seed";
import { invoke } from "@/platform/tools";

export const dynamic = "force-dynamic";

const page = (title: string, body: string, status = 200) =>
  new Response(
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${title}</title>
<body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#090b10;color:#e8eaf0;font:16px/1.5 system-ui,sans-serif">
<main style="max-width:420px;padding:28px;border:1px solid #232938;border-radius:12px;background:#11141c"><h1 style="font-size:22px;margin:0 0 8px">${title}</h1>${body}</main>`,
    { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } },
  );

/** Opening the link asks first, so a mail scanner that follows links does not unsubscribe anyone. */
export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const db = await getDb();
  if (!(await readToken(db, "unsubscribe", (await params).token))) return page("This link is not valid", "<p>It may have been cut off. Use the link in a more recent email.</p>", 404);
  return page("Stop these emails?", `<p>You will no longer receive event emails from us.</p><form method="post"><button style="background:#7c9cff;border:0;border-radius:8px;padding:10px 16px;font:inherit;font-weight:600;cursor:pointer">Unsubscribe</button></form>`);
}

/** The confirm button, and the one-click unsubscribe that mail apps send on the reader's behalf. */
export async function POST(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const db = await getDb();
  const contactId = await readToken(db, "unsubscribe", (await params).token);
  if (!contactId) return page("This link is not valid", "<p>It may have been cut off. Use the link in a more recent email.</p>", 404);
  await invoke(db, await servicePrincipal(db, "Public site"), "contact.unsubscribe", { contactId });
  return page("You're unsubscribed", "<p>You will not receive further event emails from us.</p>");
}
