import Link from "next/link";
import { and, asc, count, desc, eq, ilike, inArray, notInArray, or } from "drizzle-orm";
import QRCode from "qrcode";
import { getDb } from "@/db/client";
import { event, formField, registration, type EventKind } from "@/db/schema";
import { guestLinkAction, guestProfileAction, guestRegisterAction, guestSignOutAction } from "@/app/actions";
import { currentGuest } from "@/lib/guest";
import { emailIsSetUp } from "@/tools/portal";
import { formatWhen } from "@/lib/when";
import { countdown } from "@/lib/describe";
import { Poster, hueStyle } from "@/components/poster";
import { ThemeToggle } from "@/components/theme-toggle";

export const dynamic = "force-dynamic";
export const metadata = { title: "Your events", robots: { index: false, follow: false } };

const LABEL: Record<string, string> = {
  invited: "Invited: reply needed", pending: "Waiting for the organisers", registered: "You have a place", waitlisted: "On the waitlist",
  attended: "You attended", declined: "You declined", cancelled: "Your place was cancelled", no_show: "You have a place",
};
const TONE: Record<string, string> = { registered: "live", attended: "attended", invited: "held", pending: "held", waitlisted: "held" };
const KIND: Record<EventKind, string> = { booth: "Meet us at the stand", field: "Hosted event", conference: "Conference" };
const TABS = [{ key: "events", label: "My events" }, { key: "discover", label: "Discover" }, { key: "profile", label: "Profile" }] as const;

/**
 * An attendee's own account. Their events and passes, other events they could
 * join, and their details. Reached by signing in with their email; nothing
 * here belongs to the organising team, whose screens are behind /signin.
 */
export default async function MyEvents({ searchParams }: { searchParams: Promise<{ sent?: string; notice?: string; ok?: string; tab?: string; q?: string; kind?: string }> }) {
  const { sent, notice, ok, tab: asked, q: asksFor = "", kind: asksKind = "" } = await searchParams;
  const guest = await currentGuest();

  if (!guest) {
    return (
      <div className="center">
        <div className="card">
          <span className="kind">For attendees</span>
          <h1>Your events</h1>
          {notice && <div className="notice" style={{ marginTop: 14 }}>{notice}</div>}
          {sent ? (
            <>
              {emailIsSetUp() ? (
                <>
                  <p className="muted">If that email is on one of our guest lists, a link is on its way. Open it on this device to see your events and passes. It works for 30 minutes.</p>
                  <p className="small faint">Nothing arrived? Check the address and your spam folder, then <Link href="/my">try again</Link>.</p>
                </>
              ) : (
                <p className="muted">We could not find a registration for that email. Check the address, or register for an event first, then <Link href="/my">try again</Link>.</p>
              )}
            </>
          ) : (
            <>
              <p className="muted" style={{ margin: "8px 0 22px" }}>{emailIsSetUp() ? "Enter the email you registered with. We will send you a link to see your events and passes. No password needed." : "Enter the email you registered with to see your events and passes. No password needed."}</p>
              <form action={guestLinkAction} className="stack">
                <label>Email<input name="email" type="email" autoComplete="email" required autoFocus /></label>
                <button type="submit">{emailIsSetUp() ? "Email me a link" : "Continue"}</button>
              </form>
            </>
          )}
          <p className="small muted" style={{ margin: "18px 0 0", paddingTop: 16, borderTop: "1px solid var(--rule-soft)" }}>On the organising team? <Link href="/signin">Sign in here</Link> instead.</p>
        </div>
      </div>
    );
  }

  const tab = TABS.some((t) => t.key === asked) ? asked! : "events";
  const term = asksFor.trim().slice(0, 80);
  const like = `%${term.replace(/[%_\\]/g, "\\$&")}%`;
  const matches = term ? or(ilike(event.name, like), ilike(event.venue, like)) : undefined;
  const kind = (["booth", "field", "conference"] as const).find((k) => k === asksKind) ?? null;
  const db = await getDb();
  const now = Date.now();

  const all = await db.select({ r: registration, e: event }).from(registration).innerJoin(event, eq(event.id, registration.eventId))
    .where(eq(registration.contactId, guest.id)).orderBy(desc(event.startsAt));
  // An event that was never made public, or has been put away, is not shown to its guests.
  const mine = all.filter((x) => x.e.status !== "draft" && x.e.status !== "archived");
  const over = (e: typeof event.$inferSelect) => (e.endsAt ?? e.startsAt ?? new Date(now + 1)).getTime() + (e.endsAt ? 0 : 6 * 3600_000) < now;
  const found = (x: (typeof mine)[number]) => !term || `${x.e.name} ${x.e.venue ?? ""}`.toLowerCase().includes(term.toLowerCase());
  const upcoming = mine.filter((x) => !over(x.e) && x.e.status !== "cancelled").reverse();
  const past = mine.filter((x) => over(x.e) || x.e.status === "cancelled");
  const holding = upcoming.filter((x) => x.r.status === "registered" || x.r.checkedInAt);
  const attendedCount = mine.filter((x) => x.r.checkedInAt).length;
  const next = holding[0];

  // Events open to anyone that this guest is not on the list for.
  const open = await db.select().from(event).where(and(
    eq(event.status, "live"), mine.length ? notInArray(event.id, mine.map((x) => x.e.id)) : undefined, matches, kind ? eq(event.kind, kind) : undefined,
  )).orderBy(asc(event.startsAt)).limit(60);
  const discover = open.filter((e) => !over(e));
  const ids = discover.map((e) => e.id);
  const [taken, asks] = ids.length ? await Promise.all([
    db.select({ eventId: registration.eventId, n: count() }).from(registration).where(and(inArray(registration.eventId, ids), inArray(registration.status, ["registered", "attended"]))).groupBy(registration.eventId),
    db.select({ eventId: formField.eventId }).from(formField).where(and(inArray(formField.eventId, ids), eq(formField.purpose, "registration"), eq(formField.required, true))),
  ]) : [[], []];

  const codes = new Map(await Promise.all(holding.map(async (x) => [x.r.id, await QRCode.toString(x.r.number, { type: "svg", margin: 0, errorCorrectionLevel: "M" })] as const)));
  // An event that has started but not finished is on now, not "2 days ago".
  const when = (e: typeof event.$inferSelect) => (e.startsAt && e.startsAt.getTime() <= now ? "on now" : countdown(e.startsAt, now));
  const at = (key: string, extra = "") => `/my${key === "events" && !extra ? "" : `?tab=${key}${extra}`}`;

  const card = ({ r, e }: (typeof mine)[number], withPass: boolean) => {
    const state = r.checkedInAt ? "attended" : r.status;
    const qr = codes.get(r.id);
    return (
      <div className="card" key={r.id} style={{ marginBottom: 16, maxWidth: "none", ...hueStyle(e.id) }}>
        <div style={{ display: "flex", gap: 18, alignItems: "flex-start", flexWrap: "wrap" }}>
          <Poster event={e} size="mini" />
          <div style={{ flex: "1 1 220px", minWidth: 0 }}>
            <span className={`pill ${e.status === "cancelled" ? "cancelled" : TONE[state] ?? ""}`}>{e.status === "cancelled" ? "Event cancelled" : LABEL[state] ?? state}</span>
            <h2 style={{ margin: "10px 0 4px" }}>{e.name}</h2>
            <p className="muted" style={{ margin: 0 }}>{formatWhen(e.startsAt, e.timezone)}{withPass && e.startsAt ? ` (${when(e)})` : ""}{e.venue ? <><br />{e.venue}</> : null}</p>
            <div className="actions" style={{ marginTop: 14 }}>
              <Link className="button" href={`/e/${e.slug}/pass/${r.id}`}>{state === "invited" ? "Reply to the invitation" : state === "attended" && !withPass ? "Tell us how it was" : withPass && state === "registered" ? "Open my pass" : "Open"}</Link>
              <Link className="small" href={`/e/${e.slug}`}>Event page</Link>
              {withPass && state === "registered" && e.startsAt && <a className="small" href={`/e/${e.slug}/calendar.ics`}>Add to calendar</a>}
              {withPass && e.locationUrl && <a className="small" href={e.locationUrl} target="_blank" rel="noopener noreferrer">Map</a>}
            </div>
          </div>
          {withPass && qr && (
            <div style={{ width: 132, textAlign: "center", background: "#fff", color: "#111", borderRadius: 14, padding: 12 }}>
              <div dangerouslySetInnerHTML={{ __html: qr }} />
              <div className="small" style={{ marginTop: 6, fontWeight: 700, letterSpacing: "0.04em" }}>{r.number}</div>
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div style={{ maxWidth: 860, margin: "0 auto", padding: "22px 16px 70px" }}>
      <div className="actions" style={{ justifyContent: "space-between", marginBottom: 26 }}>
        <div className="actions"><span className="brand" style={{ padding: 0 }}>Event<i>OS</i></span><span className="pill registered">Attendee</span></div>
        <div className="actions"><ThemeToggle /><form action={guestSignOutAction}><button type="submit" className="ghost">Sign out</button></form></div>
      </div>

      <div className="head">
        <div><h1>Hi {guest.firstName}</h1><p className="muted">Signed in as {guest.email}.</p></div>
      </div>
      {notice && <div className="notice">{notice}</div>}
      {ok && <div className="notice good">{ok}</div>}

      <div className="stats">
        <div className="stat"><b>{upcoming.length}</b><span>Coming up</span></div>
        <div className="stat"><b>{attendedCount}</b><span>Attended</span></div>
        <div className="stat"><b>{discover.length}</b><span>Open to join</span></div>
        <div className="stat"><b style={{ fontSize: 20, lineHeight: 1.5 }}>{next ? when(next.e).replace(/^./, (c) => c.toUpperCase()) : "Nothing booked"}</b><span>{next ? `Next: ${next.e.name}` : "Your next event"}</span></div>
      </div>

      <nav className="tabs" aria-label="Sections">
        {TABS.map((t) => <Link key={t.key} href={at(t.key)} className={t.key === tab ? "on" : ""}>{t.label}{t.key === "events" && mine.length ? <small>{mine.length}</small> : t.key === "discover" && discover.length ? <small>{discover.length}</small> : null}</Link>)}
      </nav>

      {tab !== "profile" && (
        <form method="get" className="actions" style={{ marginBottom: 22 }}>
          <input type="hidden" name="tab" value={tab} />
          <input name="q" defaultValue={term} placeholder={tab === "discover" ? "Search events by name or place" : "Search your events"} aria-label="Search" style={{ flex: "1 1 240px", maxWidth: 380 }} />
          {tab === "discover" && (
            <select name="kind" defaultValue={kind ?? ""} aria-label="Type of event" style={{ width: "auto" }}>
              <option value="">Every type</option><option value="conference">Conferences</option><option value="field">Hosted events</option><option value="booth">Stands at shows</option>
            </select>
          )}
          <button type="submit" className="ghost">Search</button>
          {(term || kind) && <Link className="small" href={at(tab)}>Clear</Link>}
        </form>
      )}

      {tab === "events" && (
        <>
          {mine.length === 0 && <div className="empty">You are not on the list for any event yet. <Link href={at("discover")}>See what is open to join.</Link></div>}
          {mine.length > 0 && upcoming.filter(found).length + past.filter(found).length === 0 && <div className="empty">None of your events match that.</div>}
          {upcoming.filter(found).length > 0 && <><h2>Coming up</h2>{upcoming.filter(found).map((x) => card(x, true))}</>}
          {past.filter(found).length > 0 && <><h2 style={{ marginTop: 28 }}>Past</h2>{past.filter(found).map((x) => card(x, false))}</>}
        </>
      )}

      {tab === "discover" && (
        discover.length === 0 ? <div className="empty">{term || kind ? "No open events match that." : "There is nothing else open to join right now."}</div> : (
          <div className="board">
            {discover.map((e) => {
              const n = taken.find((t) => t.eventId === e.id)?.n ?? 0;
              const full = e.capacity != null && n >= e.capacity;
              const needsAnswers = asks.some((a) => a.eventId === e.id);
              return (
                <div key={e.id} className="evcard" style={hueStyle(e.id)}>
                  <Link href={`/e/${e.slug}`} style={{ color: "inherit" }}><Poster event={e} size="wide"><span className="pill">{KIND[e.kind]}</span></Poster></Link>
                  <div className="body">
                    <div className="title">{e.name}</div>
                    <div className="small muted">{formatWhen(e.startsAt, e.timezone)}{e.venue ? ` · ${e.venue}` : ""}</div>
                    <div className="small faint">{e.requireApproval ? "The organisers approve each guest" : full ? "Full: you can join the waitlist" : e.capacity != null && e.capacity - n <= 20 ? `${e.capacity - n} places left` : "Open for registration"}</div>
                    <div className="actions" style={{ marginTop: 10 }}>
                      {needsAnswers ? <Link className="button primary" href={`/e/${e.slug}`}>Register</Link> : (
                        <form action={guestRegisterAction}><input type="hidden" name="eventSlug" value={e.slug} /><button type="submit">{e.requireApproval ? "Ask to join" : full ? "Join the waitlist" : "Register"}</button></form>
                      )}
                      <Link className="small" href={`/e/${e.slug}`}>Details</Link>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )
      )}

      {tab === "profile" && (
        <div className="card" style={{ maxWidth: 560 }}>
          <h2>Your details</h2>
          <form action={guestProfileAction} className="stack">
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              <label>First name<input name="firstName" required maxLength={80} defaultValue={guest.firstName} autoComplete="given-name" /></label>
              <label>Last name<input name="lastName" maxLength={80} defaultValue={guest.lastName ?? ""} autoComplete="family-name" /></label>
            </div>
            <label>Email<input value={guest.email} readOnly disabled /></label>
            <label>Job title<input name="title" maxLength={120} defaultValue={guest.title ?? ""} autoComplete="organization-title" /></label>
            <label>Mobile, in international format<input name="phone" placeholder="+919876543210" defaultValue={guest.phone ?? ""} autoComplete="tel" /></label>
            <label className="check"><input type="checkbox" name="emailUpdates" defaultChecked={!guest.emailOptOutAt} /> Email me reminders and updates about my events</label>
            <label className="check"><input type="checkbox" name="whatsappOptIn" defaultChecked={Boolean(guest.whatsappOptInAt)} /> Send me event updates on WhatsApp</label>
            <div className="actions"><button type="submit">Save</button><span className="small faint">Your email is how you sign in, so it cannot be changed here. Ask the organisers if it needs correcting.</span></div>
          </form>
        </div>
      )}
    </div>
  );
}
