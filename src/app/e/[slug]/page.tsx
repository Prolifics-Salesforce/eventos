import { notFound } from "next/navigation";
import Link from "next/link";
import { and, asc, count, eq, inArray } from "drizzle-orm";
import { getDb } from "@/db/client";
import { contact, event, eventSession, formField, registration, sessionSpeaker } from "@/db/schema";
import { agentsEnabled } from "@/agents/model";
import { FieldInputs } from "@/components/field-inputs";
import { Poster, hueStyle } from "@/components/poster";
import { ThemeToggle } from "@/components/theme-toggle";
import { registerGuestAction } from "@/app/actions";
import { initials } from "@/lib/describe";
import { emailIsSetUp } from "@/tools/portal";

export const dynamic = "force-dynamic";

const Pin = () => <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M10 17.5s5.5-4.6 5.5-9a5.5 5.5 0 0 0-11 0c0 4.4 5.5 9 5.5 9z" /><circle cx="10" cy="8.5" r="2" /></svg>;

/**
 * An event's public page: its poster on one side; on the other, when and
 * where it is, the way to register, what it is about and the agenda.
 */
export default async function PublicEvent({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ notice?: string; done?: string; ref?: string }> }) {
  const { slug } = await params;
  const { notice, done, ref } = await searchParams;
  const db = await getDb();
  const [e] = await db.select().from(event).where(eq(event.slug, slug));
  // A draft or archived event does not exist as far as the public is concerned.
  if (!e || e.status === "draft" || e.status === "archived") notFound();
  const fields = await db.select().from(formField).where(and(eq(formField.eventId, e.id), eq(formField.purpose, "registration")));
  const sessions = await db.select().from(eventSession).where(eq(eventSession.eventId, e.id)).orderBy(asc(eventSession.startsAt));
  const speakers = sessions.length ? await db.select({ sessionId: sessionSpeaker.sessionId, c: contact }).from(sessionSpeaker).innerJoin(contact, eq(contact.id, sessionSpeaker.contactId)).where(inArray(sessionSpeaker.sessionId, sessions.map((x) => x.id))) : [];
  const [taken] = await db.select({ n: count() }).from(registration).where(and(eq(registration.eventId, e.id), inArray(registration.status, ["registered", "attended"])));
  const full = e.capacity != null && taken.n >= e.capacity;
  const left = e.capacity != null ? e.capacity - taken.n : null;
  const kind = { booth: "Meet us at the stand", field: "You are invited", conference: "Conference" }[e.kind];
  const on = (date: Date, opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-IN", { timeZone: e.timezone, ...opts }).format(date);
  const clock = (date: Date) => on(date, { hour: "numeric", minute: "2-digit" });
  const heading = e.status === "cancelled" ? "Cancelled" : done ? "You're in" : e.status === "closed" ? "Registration closed" : e.requireApproval ? "Approval required" : full ? "Waitlist" : "Registration";

  return (
    <div className="hue" style={hueStyle(e.id)}>
      <div style={{ position: "absolute", top: 16, right: 16 }}><ThemeToggle /></div>
      <div className="evt">
        <aside className="side">
          <Poster event={e} />
          {e.hostName && (
            <div className="by">
              <span className="avatar" style={{ width: 38, height: 38, fontSize: 14 }}>{initials(e.hostName)}</span>
              <div><div className="small muted">Hosted by</div><div style={{ fontWeight: 600 }}>{e.hostName}</div></div>
            </div>
          )}
          <div className="small"><Link href="/my">Already registered? See your events and passes.</Link></div>
          {e.status === "live" && agentsEnabled() && <div className="small"><Link href={`/e/${e.slug}/ask`}>Have a question about this event? Ask here.</Link></div>}
        </aside>

        <main>
          <span className="kind">{kind}</span>
          <h1>{e.name}</h1>

          <div className="lead">
            <div className="tile">
              <div className="ico cal">{e.startsAt ? <><span>{on(e.startsAt, { month: "short" })}</span><b>{on(e.startsAt, { day: "numeric" })}</b></> : <><span>Soon</span><b>?</b></>}</div>
              <div>
                <b>{e.startsAt ? on(e.startsAt, { weekday: "long", day: "numeric", month: "long", year: "numeric" }) : "Date to be announced"}</b>
                {e.startsAt && <span>{clock(e.startsAt)}{e.endsAt ? ` to ${clock(e.endsAt)}` : ""} · {e.timezone.replace(/_/g, " ")}</span>}
              </div>
            </div>
            {e.onlineUrl && (
              <div className="tile">
                <div className="ico"><svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="2.5" y="5" width="10.5" height="10" rx="2.5" /><path d="M13 9l4.5-2.5v7L13 11" /></svg></div>
                <div><b>{e.venue ? "Also online" : "Online"}</b><span>The link to join is on your pass once you have a place</span></div>
              </div>
            )}
            {e.venue && (
              <div className="tile">
                <div className="ico"><Pin /></div>
                <div><b>{e.venue}</b>{e.locationUrl ? <span><a href={e.locationUrl} target="_blank" rel="noopener noreferrer">Open the map</a></span> : null}</div>
              </div>
            )}
          </div>

          <div className="box">
            <header>{heading}{!done && e.status === "live" && left != null && left > 0 && left <= 20 ? ` · ${left} ${left === 1 ? "place" : "places"} left` : ""}</header>
            <div className="in">
              {e.status === "cancelled" ? (
                <div className="notice" style={{ margin: 0 }}>This event has been cancelled.</div>
              ) : done ? (
                <>
                  <div className="notice good">{done === "already" ? "You're already registered for this event. Open your events to see your pass." : done === "wait" ? "You're on the waitlist. We will email you the moment a place opens." : done === "pending" ? "Thanks. The organisers approve each guest, and we will email you as soon as they have decided." : emailIsSetUp() ? "You're registered. Your pass is on its way by email." : "You're registered. Open your events below to see your pass."}</div>
                  <div className="actions">
                    {done === "1" && e.startsAt && <a className="button" href={`/e/${e.slug}/calendar.ics`}>Add to your calendar</a>}
                    <Link className="button" href="/my">See your events and passes</Link>
                  </div>
                </>
              ) : e.status === "closed" ? (
                <div className="notice quiet" style={{ margin: 0 }}>Registration for this event has closed.</div>
              ) : (
                <>
                  {notice && <div className="notice">{notice}</div>}
                  {e.requireApproval && <div className="notice quiet">The organisers approve each guest. You will hear back by email.</div>}
                  {full && !e.requireApproval && <div className="notice quiet">Every place is taken. Join the waitlist and we will email you if one opens.</div>}
                  <form action={registerGuestAction} className="stack">
                    <input type="hidden" name="eventSlug" value={e.slug} />
                    {ref && /^REG\d{1,12}$/i.test(ref) && <input type="hidden" name="ref" value={ref.toUpperCase()} />}
                    <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                      <label>First name<input name="firstName" required autoComplete="given-name" /></label>
                      <label>Last name<input name="lastName" autoComplete="family-name" /></label>
                    </div>
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
            </div>
          </div>

          {e.description && (
            <section className="about">
              <h2>About this event</h2>
              {e.description.split(/\n{2,}/).map((para, i) => <p key={i}>{para}</p>)}
            </section>
          )}

          {sessions.length > 0 && (
            <section>
              <h2>Agenda</h2>
              <div className="agenda" style={{ borderTop: 0, marginTop: 0 }}>
                {sessions.map((x) => (
                  <div key={x.id}>
                    <time>{x.startsAt ? on(x.startsAt, { hour: "numeric", minute: "2-digit", hour12: false }) : ""}</time>
                    <div><b>{x.title}</b><span>{[speakers.filter((p) => p.sessionId === x.id).map((p) => `${p.c.firstName} ${p.c.lastName ?? ""}`.trim() + (p.c.title ? `, ${p.c.title}` : "")).join("; "), x.room].filter(Boolean).join(" · ")}</span></div>
                  </div>
                ))}
              </div>
            </section>
          )}
        </main>
      </div>
    </div>
  );
}
