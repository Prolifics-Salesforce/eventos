import Link from "next/link";
import { notFound } from "next/navigation";
import { and, desc, eq, ilike, or } from "drizzle-orm";
import { getDb } from "@/db/client";
import { can, requirePrincipal } from "@/lib/session";
import { Denied } from "@/components/denied";

import { contact, event, registration } from "@/db/schema";
import { checkInAction, scanCheckInAction, undoCheckInAction, walkInAction } from "@/app/actions";
import { QrScanner } from "@/components/qr-scanner";

export default async function Desk({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ q?: string; notice?: string; ok?: string; scan?: string }> }) {
  const { id } = await params;
  const { q = "", notice, ok, scan } = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  if (!can(await requirePrincipal(), "checkin.write")) return <Denied title="Door desk" />;
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
      <QrScanner action={scanCheckInAction} eventId={id} auto={scan === "1"} />
      <form method="get" className="row" style={{ marginBottom: 8 }}>
        <input name="q" defaultValue={term} placeholder="Name, email or pass number" autoFocus style={{ flex: 1 }} />
        <button type="submit">Find</button>
      </form>
      <details className="add" style={{ marginBottom: 12 }}>
        <summary>+ Someone not on the list</summary>
        <form action={walkInAction} className="stack">
          <input type="hidden" name="eventId" value={id} /><input type="hidden" name="returnTo" value={`/events/${id}/desk`} />
          <label>First name<input name="firstName" required autoComplete="off" /></label>
          <label>Last name<input name="lastName" autoComplete="off" /></label>
          <label>Email<input name="email" type="email" required autoComplete="off" inputMode="email" /></label>
          <button type="submit">Register and check in</button>
        </form>
      </details>
      {guests.length === 0 ? <div className="empty">{term ? "Nobody matches that." : "Nobody is registered yet."}</div> : guests.map(({ r, c }) => (
        <div className="guest" key={r.id}>
          <div><b>{c.firstName} {c.lastName}</b><span className="small muted">{c.email}</span></div>
          {r.checkedInAt ? (
            <form action={undoCheckInAction} className="actions">
              <input type="hidden" name="eventId" value={id} /><input type="hidden" name="registrationId" value={r.id} /><input type="hidden" name="returnTo" value={back} />
              <span className="pill attended">In, PIN {r.pin}</span><button type="submit" className="link">Undo</button>
            </form>
          ) : r.status === "pending" ? <span className="pill held">Not approved yet</span> : r.status === "cancelled" || r.status === "declined" ? <span className="pill">{r.status}</span> : (
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
