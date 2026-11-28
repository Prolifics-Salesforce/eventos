import Link from "next/link";
import { asc, count, eq, isNotNull, and } from "drizzle-orm";
import { getDb } from "@/db/client";
import { event, registration } from "@/db/schema";
import { createEventAction } from "@/app/actions";
import { countdown } from "@/lib/describe";
import { Poster, hueStyle } from "@/components/poster";
import { DEFAULT_TIMEZONE, timeZones } from "@/lib/when";
import { can, requirePrincipal } from "@/lib/session";
import { Denied } from "@/components/denied";


const KIND = { booth: "Booth", field: "Field event", conference: "Conference" } as const;

export default async function Events({ searchParams }: { searchParams: Promise<{ notice?: string }> }) {
  const { notice } = await searchParams;
  const me = await requirePrincipal();
  if (!can(me, "event.read")) return <Denied title="Events" />;
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
      {can(me, "event.write") && <details className="add" open={rows.length === 0}>
        <summary>+ New event</summary>
        <form action={createEventAction} className="stack">
          <div className="row" style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <label style={{ flexBasis: 280 }}>Name<input name="name" required minLength={2} placeholder="Hyderabad Partner Summit" /></label>
            <label>Type<select name="kind" defaultValue="booth"><option value="booth">Booth at someone else's show</option><option value="field">Field event we host</option><option value="conference">Conference with sessions</option></select></label>
            <label>Starts<input name="startsAt" type="datetime-local" /></label>
            <label>Time zone<select name="timezone" defaultValue={DEFAULT_TIMEZONE}>{timeZones().map((z) => <option key={z}>{z}</option>)}</select></label>
            <label>Venue<input name="venue" placeholder="HICC, Hyderabad" /></label>
          </div>
          <label>What is this event for? Agents plan from this.<textarea name="brief" placeholder="Who should come, how many, and what a good result looks like." /></label>
          <div><button type="submit">Create draft</button></div>
        </form>
      </details>}
      {rows.length === 0 ? <div className="empty">No events yet.{can(me, "event.write") ? " Create the first one above." : ""}</div> : (
        <div className="board">
          {rows.map(({ event: e, registrations }) => {
            const inCount = checked.find((c) => c.eventId === e.id)?.n ?? 0;
            return (
              <Link key={e.id} href={`/events/${e.id}`} className="evcard" style={hueStyle(e.id)}>
                <Poster event={e} size="wide"><span className={`pill ${e.status}`}>{e.status}</span></Poster>
                <div className="body">
                  <div className="title">{e.name}</div>
                  <div className="small muted">{KIND[e.kind]}{e.venue ? ` · ${e.venue}` : ""}</div>
                  <div className="meta">
                    <span className="small muted">{registrations} registered{inCount > 0 ? ` · ${inCount} in` : ""}</span>
                    <span className="small faint">{countdown(e.startsAt)}</span>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </>
  );
}
