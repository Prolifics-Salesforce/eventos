import Link from "next/link";
import { notFound } from "next/navigation";
import { and, desc, eq, ilike, or } from "drizzle-orm";
import { getDb } from "@/db/client";
import { contact, event, registration } from "@/db/schema";
import { checkInAction } from "@/app/actions";

export default async function Desk({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ q?: string; notice?: string; ok?: string }> }) {
  const { id } = await params;
  const { q = "", notice, ok } = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const db = await getDb();
  const [e] = await db.select().from(event).where(eq(event.id, id));
  if (!e) notFound();
  const term = q.trim();
  const like = `%${term.replace(/[%_\\]/g, "\\$&")}%`;
  const guests = await db.select({ r: registration, c: contact }).from(registration).innerJoin(contact, eq(contact.id, registration.contactId))
    .where(and(eq(registration.eventId, id), term ? or(ilike(contact.firstName, like), ilike(contact.lastName, like), ilike(contact.email, like), ilike(registration.number, like)) : undefined))
    .orderBy(desc(registration.checkedInAt), contact.firstName).limit(30);
  const all = await db.select({ at: registration.checkedInAt }).from(registration).where(eq(registration.eventId, id));
  const back = `/events/${id}/desk${term ? `?q=${encodeURIComponent(term)}` : ""}`;
  return (
    <>
      <div className="progress">
        <div className="small muted"><Link href={`/events/${id}`}>Back to {e.name}</Link></div>
        <div className="big" style={{ marginTop: 8 }}>{all.filter((x) => x.at).length} <em>of {all.length} checked in</em></div>
        <div className="meter"><i style={{ width: `${all.length ? (all.filter((x) => x.at).length / all.length) * 100 : 0}%` }} /></div>
      </div>
      {notice && <div className="notice">{notice}</div>}
      {ok && <div className="notice good">{ok}</div>}
      <form method="get" className="row" style={{ marginBottom: 8 }}>
        <input name="q" defaultValue={term} placeholder="Name, email or pass number" autoFocus style={{ flex: 1 }} />
        <button type="submit">Find</button>
      </form>
      {guests.length === 0 ? <div className="empty">{term ? "Nobody matches that." : "Nobody is registered yet."}</div> : guests.map(({ r, c }) => (
        <div className="guest" key={r.id}>
          <div><b>{c.firstName} {c.lastName}</b><span className="small muted">{c.email}</span></div>
          {r.checkedInAt ? <span className="pill attended">In, PIN {r.pin}</span> : (
            <form action={checkInAction}>
              <input type="hidden" name="eventId" value={id} /><input type="hidden" name="registrationId" value={r.id} /><input type="hidden" name="returnTo" value={back} />
              <button type="submit">Check in</button>
            </form>
          )}
        </div>
      ))}
    </>
  );
}
