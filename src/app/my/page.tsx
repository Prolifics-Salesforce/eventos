import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import QRCode from "qrcode";
import { getDb } from "@/db/client";
import { event, registration } from "@/db/schema";
import { guestLinkAction, guestSignOutAction } from "@/app/actions";
import { currentGuest } from "@/lib/guest";
import { formatWhen } from "@/lib/when";

export const dynamic = "force-dynamic";
export const metadata = { title: "Your events", robots: { index: false, follow: false } };

const LABEL: Record<string, string> = {
  invited: "Invited: reply needed", pending: "Waiting for the organisers", registered: "You have a place", waitlisted: "On the waitlist",
  attended: "You attended", declined: "You declined", cancelled: "Your place was cancelled", no_show: "You have a place",
};
const TONE: Record<string, string> = { registered: "live", attended: "attended", invited: "held", pending: "held", waitlisted: "held" };

/**
 * A guest's own page: every event they are on the list for, with the pass for
 * each. Reached by a link sent to their email; there is no password.
 */
export default async function MyEvents({ searchParams }: { searchParams: Promise<{ sent?: string; notice?: string }> }) {
  const { sent, notice } = await searchParams;
  const guest = await currentGuest();

  if (!guest) {
    return (
      <div className="center">
        <div className="card">
          <h1>Your events</h1>
          {notice && <div className="notice" style={{ marginTop: 14 }}>{notice}</div>}
          {sent ? (
            <>
              <p className="muted">If that email is on one of our guest lists, a link is on its way. Open it on this device to see your events and passes. It works for 30 minutes.</p>
              <p className="small faint">Nothing arrived? Check the address and your spam folder, then <Link href="/my">try again</Link>.</p>
            </>
          ) : (
            <>
              <p className="muted" style={{ margin: "8px 0 22px" }}>Enter the email you registered with. We will send you a link to see your events and passes. No password needed.</p>
              <form action={guestLinkAction} className="stack">
                <label>Email<input name="email" type="email" autoComplete="email" required autoFocus /></label>
                <button type="submit">Email me a link</button>
              </form>
            </>
          )}
        </div>
      </div>
    );
  }

  const db = await getDb();
  const all = await db.select({ r: registration, e: event }).from(registration).innerJoin(event, eq(event.id, registration.eventId))
    .where(eq(registration.contactId, guest.id)).orderBy(desc(event.startsAt));
  // An event that was never made public, or has been put away, is not shown to its guests.
  const rows = all.filter((x) => x.e.status !== "draft" && x.e.status !== "archived");
  const now = Date.now();
  const over = (e: typeof event.$inferSelect) => (e.endsAt ?? e.startsAt ?? new Date(now + 1)).getTime() + (e.endsAt ? 0 : 6 * 3600_000) < now;
  const upcoming = rows.filter((x) => !over(x.e) && x.e.status !== "cancelled").reverse();
  const past = rows.filter((x) => over(x.e) || x.e.status === "cancelled");
  const codes = new Map(await Promise.all(upcoming.filter((x) => x.r.status === "registered" || x.r.checkedInAt).map(async (x) => [x.r.id, await QRCode.toString(x.r.number, { type: "svg", margin: 0, errorCorrectionLevel: "M" })] as const)));

  const card = ({ r, e }: (typeof rows)[number], withPass: boolean) => {
    const state = r.checkedInAt ? "attended" : r.status;
    const qr = codes.get(r.id);
    return (
      <div className="card" key={r.id} style={{ marginBottom: 16, maxWidth: "none" }}>
        <div style={{ display: "flex", gap: 18, alignItems: "flex-start", flexWrap: "wrap" }}>
          <div style={{ flex: "1 1 240px", minWidth: 0 }}>
            <span className={`pill ${e.status === "cancelled" ? "cancelled" : TONE[state] ?? ""}`}>{e.status === "cancelled" ? "Event cancelled" : LABEL[state] ?? state}</span>
            <h2 style={{ margin: "10px 0 4px" }}>{e.name}</h2>
            <p className="muted" style={{ margin: 0 }}>{formatWhen(e.startsAt, e.timezone)}{e.venue ? <><br />{e.venue}</> : null}</p>
            <div className="actions" style={{ marginTop: 14 }}>
              <Link className="button" href={`/e/${e.slug}/pass/${r.id}`}>{state === "invited" ? "Reply to the invitation" : state === "attended" && !withPass ? "Tell us how it was" : "Open"}</Link>
              {withPass && state === "registered" && e.startsAt && <a className="small" href={`/e/${e.slug}/calendar.ics`}>Add to your calendar</a>}
            </div>
          </div>
          {withPass && qr && (
            <div style={{ width: 132, textAlign: "center", background: "#fff", color: "#111", borderRadius: 12, padding: 12 }}>
              <div dangerouslySetInnerHTML={{ __html: qr }} />
              <div className="small" style={{ marginTop: 6, fontWeight: 600, letterSpacing: "0.04em" }}>{r.number}</div>
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div style={{ maxWidth: 680, margin: "0 auto", padding: "36px 16px 60px" }}>
      <div className="head">
        <div><h1>Hi {guest.firstName}</h1><p className="muted">Your events and passes. Signed in as {guest.email}.</p></div>
        <form action={guestSignOutAction}><button type="submit" className="ghost">Sign out</button></form>
      </div>
      {rows.length === 0 && <div className="empty">You are not on the list for any event at the moment.</div>}
      {upcoming.length > 0 && <><h2>Coming up</h2>{upcoming.map((x) => card(x, true))}</>}
      {past.length > 0 && <><h2 style={{ marginTop: 28 }}>Past</h2>{past.map((x) => card(x, false))}</>}
    </div>
  );
}
