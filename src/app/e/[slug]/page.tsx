import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { contact, event, eventSession, formField, registration, sessionSpeaker } from "@/db/schema";
import { asc, count, inArray } from "drizzle-orm";
import { and } from "drizzle-orm";
import Link from "next/link";
import { agentsEnabled } from "@/agents/model";
import { FieldInputs } from "@/components/field-inputs";
import { registerGuestAction } from "@/app/actions";
import { formatWhen } from "@/lib/when";

export const dynamic = "force-dynamic";

export default async function PublicEvent({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ notice?: string; done?: string }> }) {
  const { slug } = await params;
  const { notice, done } = await searchParams;
  const db = await getDb();
  const [e] = await db.select().from(event).where(eq(event.slug, slug));
  // A draft or archived event does not exist as far as the public is concerned.
  if (!e || e.status === "draft" || e.status === "archived") notFound();
  const fields = await db.select().from(formField).where(and(eq(formField.eventId, e.id), eq(formField.purpose, "registration")));
  const sessions = await db.select().from(eventSession).where(eq(eventSession.eventId, e.id)).orderBy(asc(eventSession.startsAt));
  const speakers = sessions.length ? await db.select({ sessionId: sessionSpeaker.sessionId, c: contact }).from(sessionSpeaker).innerJoin(contact, eq(contact.id, sessionSpeaker.contactId)).where(inArray(sessionSpeaker.sessionId, sessions.map((x) => x.id))) : [];
  const [taken] = await db.select({ n: count() }).from(registration).where(and(eq(registration.eventId, e.id), inArray(registration.status, ["registered", "attended"])));
  const full = e.capacity != null && taken.n >= e.capacity;
  const kind = { booth: "Meet us at the stand", field: "You are invited", conference: "Conference" }[e.kind];
  return (
    <div className="center">
      <div className="card" style={{ maxWidth: 480 }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {e.coverImageUrl && <img src={e.coverImageUrl} alt="" style={{ width: "100%", aspectRatio: "16 / 9", objectFit: "cover", borderRadius: 14, marginBottom: 18, display: "block" }} />}
        <span className="kind">{kind}</span>
        <h1>{e.name}</h1>
        {e.hostName && <p className="small muted" style={{ margin: "6px 0 0" }}>Hosted by {e.hostName}</p>}
        <div className="when">
          <div className="datebox" style={{ textAlign: "left" }}>
            {e.startsAt ? <><b>{new Intl.DateTimeFormat("en-IN", { day: "numeric", timeZone: e.timezone }).format(e.startsAt)}</b><span>{new Intl.DateTimeFormat("en-IN", { month: "short", year: "numeric", timeZone: e.timezone }).format(e.startsAt)}</span></> : <span>Date to be announced</span>}
          </div>
          <div>{e.startsAt && new Intl.DateTimeFormat("en-IN", { weekday: "long", hour: "numeric", minute: "2-digit", timeZone: e.timezone }).format(e.startsAt)}{e.venue && <><br />{e.venue}</>}{e.locationUrl && <> · <a href={e.locationUrl} target="_blank" rel="noopener noreferrer">Map</a></>}</div>
        </div>
        {e.description && <div style={{ margin: "0 0 20px" }}>{e.description.split(/\n{2,}/).map((para, i) => <p key={i} className="muted" style={{ margin: "0 0 10px", whiteSpace: "pre-line" }}>{para}</p>)}</div>}
        {sessions.length > 0 && (
          <div className="agenda">
            {sessions.map((x) => (
              <div key={x.id}>
                <time>{x.startsAt ? new Intl.DateTimeFormat("en-IN", { hour: "numeric", minute: "2-digit", hour12: false, timeZone: e.timezone }).format(x.startsAt) : ""}</time>
                <div><b>{x.title}</b><span>{[speakers.filter((p) => p.sessionId === x.id).map((p) => `${p.c.firstName} ${p.c.lastName ?? ""}`.trim() + (p.c.title ? `, ${p.c.title}` : "")).join("; "), x.room].filter(Boolean).join(" · ")}</span></div>
              </div>
            ))}
          </div>
        )}
        {e.status === "cancelled" ? (
          <div className="notice">This event has been cancelled.</div>
        ) : done ? (
          <>
            <div className="notice good">{done === "wait" ? "You're on the waitlist. We will email you the moment a place opens." : done === "pending" ? "Thanks. The organisers approve each guest, and we will email you as soon as they have decided." : "You're registered. Your pass is on its way by email."}</div>
            {done === "1" && e.startsAt && <a className="button" href={`/e/${e.slug}/calendar.ics`}>Add to your calendar</a>}
          </>
        ) : e.status === "closed" ? (
          <div className="notice">Registration for this event has closed.</div>
        ) : (
          <>
            {notice && <div className="notice">{notice}</div>}
            {e.requireApproval && <div className="notice quiet">The organisers approve each guest. You will hear back by email.</div>}
            {full && !e.requireApproval && <div className="notice quiet">Every place is taken. Join the waitlist and we will email you if one opens.</div>}
            <form action={registerGuestAction} className="stack">
              <input type="hidden" name="eventSlug" value={e.slug} />
              <label>First name<input name="firstName" required autoComplete="given-name" /></label>
              <label>Last name<input name="lastName" autoComplete="family-name" /></label>
              <label>Work email<input name="email" type="email" required autoComplete="email" /></label>
              <label>Mobile (optional)<input name="phone" placeholder="+919876543210" autoComplete="tel" /></label>
              <FieldInputs fields={fields} />
              <label className="check"><input type="checkbox" name="whatsappOptIn" /> Send me event updates on WhatsApp</label>
              <input name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" style={{ position: "absolute", left: "-9999px" }} />
              <button type="submit">{e.requireApproval ? "Ask to join" : full ? "Join the waitlist" : "Register"}</button>
              <p className="small faint" style={{ margin: 0 }}>We use these details to run this event and to send you updates about it. Every email has an unsubscribe link.</p>
            </form>
          </>
        )}
        {e.status === "live" && agentsEnabled() && <div className="small" style={{ marginTop: 16 }}><Link href={`/e/${e.slug}/ask`}>Have a question about this event? Ask here.</Link></div>}
      </div>
    </div>
  );
}
