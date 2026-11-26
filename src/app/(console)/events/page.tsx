import Link from "next/link";
import { asc, count, eq, isNotNull, and } from "drizzle-orm";
import { getDb } from "@/db/client";
import { event, registration } from "@/db/schema";
import { createEventAction } from "@/app/actions";
import { countdown } from "@/lib/describe";
import { requirePrincipal } from "@/lib/session";

const KIND = { booth: "Booth", field: "Field event", conference: "Conference" } as const;

export default async function Events({ searchParams }: { searchParams: Promise<{ notice?: string }> }) {
  const { notice } = await searchParams;
  await requirePrincipal();
  const db = await getDb();
  const [rows, checked] = await Promise.all([
    db.select({ event, registrations: count(registration.id) }).from(event)
      .leftJoin(registration, eq(registration.eventId, event.id)).groupBy(event.id).orderBy(asc(event.startsAt)),
    db.select({ eventId: registration.eventId, n: count() }).from(registration).where(and(isNotNull(registration.checkedInAt))).groupBy(registration.eventId),
  ]);
  return (
    <>
      <div className="head"><div><h1>Events</h1><p className="muted">Booths, field events and conferences, in date order.</p></div></div>
      {notice && <div className="notice">{notice}</div>}
      <details className="add" open={rows.length === 0}>
        <summary>+ New event</summary>
        <form action={createEventAction} className="stack">
          <div className="row" style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <label style={{ flexBasis: 280 }}>Name<input name="name" required minLength={2} placeholder="Hyderabad Partner Summit" /></label>
            <label>Type<select name="kind" defaultValue="booth"><option value="booth">Booth at someone else's show</option><option value="field">Field event we host</option><option value="conference">Conference with sessions</option></select></label>
            <label>Starts<input name="startsAt" type="datetime-local" /></label>
            <label>Venue<input name="venue" placeholder="HICC, Hyderabad" /></label>
          </div>
          <label>What is this event for? Agents plan from this.<textarea name="brief" placeholder="Who should come, how many, and what a good result looks like." /></label>
          <input type="hidden" name="timezone" value="Asia/Kolkata" />
          <div><button type="submit">Create draft</button></div>
        </form>
      </details>
      {rows.length === 0 ? <div className="empty">No events yet. Create the first one above.</div> : (
        <div className="rows">
          {rows.map(({ event: e, registrations }) => {
            const inCount = checked.find((c) => c.eventId === e.id)?.n ?? 0;
            return (
              <Link key={e.id} href={`/events/${e.id}`} className="rowlink">
                <div className="datebox">
                  {e.startsAt ? <><b>{new Intl.DateTimeFormat("en-IN", { day: "numeric", timeZone: e.timezone }).format(e.startsAt)}</b><span>{new Intl.DateTimeFormat("en-IN", { month: "short", year: "2-digit", timeZone: e.timezone }).format(e.startsAt)}</span></> : <span>No date</span>}
                </div>
                <div>
                  <div className="title">{e.name}</div>
                  <div className="small muted">{KIND[e.kind]}{e.venue ? `, ${e.venue}` : ""}, {countdown(e.startsAt)}</div>
                </div>
                <div className="actions">
                  <span className="small muted">{registrations} registered{inCount > 0 ? `, ${inCount} in` : ""}</span>
                  <span className={`pill ${e.status}`}>{e.status}</span>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </>
  );
}
