import { notFound } from "next/navigation";
import { and, asc, eq, inArray } from "drizzle-orm";
import QRCode from "qrcode";
import { getDb } from "@/db/client";
import { can, requirePrincipal } from "@/lib/session";
import { Denied } from "@/components/denied";

import { contact, event, registration } from "@/db/schema";

/** One badge per registered guest, sized 86 by 120 mm, ready for the browser's Print. */
export default async function Badges({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ only?: string }> }) {
  const { id } = await params;
  const { only } = await searchParams;
  const one = only && /^[0-9a-f-]{36}$/i.test(only) ? only : null;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  if (!can(await requirePrincipal(), "contact.read")) return <Denied title="Badges" />;
  const db = await getDb();
  const [e] = await db.select().from(event).where(eq(event.id, id));
  if (!e) notFound();
  const guests = await db.select({ r: registration, c: contact }).from(registration).innerJoin(contact, eq(contact.id, registration.contactId))
    .where(and(eq(registration.eventId, id), inArray(registration.status, ["registered", "attended"]), one ? eq(registration.id, one) : undefined)).orderBy(asc(contact.firstName));
  const codes = await Promise.all(guests.map((g) => QRCode.toString(g.r.number, { type: "svg", margin: 0 })));
  return (
    <div style={{ margin: "-20px -16px -70px", maxWidth: "none" }}>
      <div className="printbar"><b>{guests.length} {guests.length === 1 ? "badge" : "badges"} for {e.name}</b><span className="small muted">Use your browser's Print (⌘P). Each badge is 86 × 120 mm.</span></div>
      <div className="badges">
        {guests.map(({ r, c }, i) => (
          <div className="badge" key={r.id}>
            <div className="ev">{e.name}</div>
            <div><div className="nm">{c.firstName}<br />{c.lastName}</div><div className="co">{String((r.custom as Record<string, unknown>).company ?? c.title ?? "")}</div></div>
            <div><div dangerouslySetInnerHTML={{ __html: codes[i] }} /><div className="rg">{r.number}</div></div>
          </div>
        ))}
      </div>
    </div>
  );
}
