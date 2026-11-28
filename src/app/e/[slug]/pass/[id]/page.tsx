import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import QRCode from "qrcode";
import { getDb } from "@/db/client";
import { contact, event, formField, registration, surveyResponse } from "@/db/schema";
import { guestCancelAction, rsvpAction, surveyAction } from "@/app/actions";
import { FieldInputs } from "@/components/field-inputs";
import { formatWhen } from "@/lib/when";
import { hueStyle } from "@/components/poster";

export const dynamic = "force-dynamic";
// The link is the credential, like a boarding pass: keep it out of search engines.
export const metadata = { robots: { index: false, follow: false } };

/**
 * The guest's own page, reached from their invitation or confirmation email.
 * It is whatever they need next: a reply to an invitation, a pass, a place on
 * the waitlist, or a question about how the event went.
 */
export default async function Pass({ params, searchParams }: { params: Promise<{ slug: string; id: string }>; searchParams: Promise<{ notice?: string; thanks?: string; welcome?: string }> }) {
  const { slug, id } = await params;
  const { notice, thanks, welcome } = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const db = await getDb();
  const [row] = await db.select({ r: registration, c: contact, e: event }).from(registration)
    .innerJoin(contact, eq(contact.id, registration.contactId)).innerJoin(event, eq(event.id, registration.eventId))
    .where(and(eq(registration.id, id), eq(event.slug, slug)));
  if (!row) notFound();
  const { r, c, e } = row;
  const state = r.checkedInAt ? "attended" : r.status;
  const label = { invited: "You're invited", pending: "Request received", registered: "Your pass", waitlisted: "On the waitlist", declined: "You declined", cancelled: "Cancelled", attended: "Checked in", no_show: "Your pass" }[state];
  const open = e.status === "live";
  const [fields, [answered]] = await Promise.all([
    state === "invited" || state === "declined" || state === "cancelled" ? db.select().from(formField).where(and(eq(formField.eventId, e.id), eq(formField.purpose, "registration"))) : [],
    db.select().from(surveyResponse).where(eq(surveyResponse.registrationId, id)),
  ]);
  const qr = e.status !== "cancelled" && (state === "registered" || state === "attended") ? await QRCode.toString(r.number, { type: "svg", margin: 0, errorCorrectionLevel: "M" }) : null;
  const key = <input type="hidden" name="registrationId" value={r.id} />;
  return (
    <div className="center hue" style={hueStyle(e.id)}>
      <div className="ticket">
        <div className="top">
          <span className="kind">{label}</span>
          <h1>{c.firstName} {c.lastName}</h1>
          <p>{e.name}<br />{formatWhen(e.startsAt, e.timezone)}{e.venue ? `, ${e.venue}` : ""}</p>
        </div>
        <div className="tear" />
        <div className="stub">
          {notice && <div className="notice">{notice}</div>}
          {welcome && e.status !== "cancelled" && (state === "registered" || state === "waitlisted" || state === "pending") && (
            <div className="notice good">
              {state === "registered" ? "You're registered. This is your pass." : state === "waitlisted" ? "You're on the waitlist." : "Your request is in."}{" "}
              You can come back to it any time: open <a href="/my">Your events</a> and enter your email.
            </div>
          )}
          <p className="small" style={{ margin: "0 0 10px", opacity: 0.7 }}><a href="/my" style={{ color: "inherit", textDecoration: "underline" }}>All my events</a></p>
          {e.status === "cancelled" && <div className="notice">This event has been cancelled.</div>}
          {state === "pending" && (
            <>
              <p style={{ margin: "0 0 4px" }}>The organisers approve each guest. We will email you as soon as they have decided, and this page will turn into your pass.</p>
              {open && <form action={guestCancelAction}>{key}<button type="submit" className="quiet">Withdraw my request</button></form>}
            </>
          )}
          {qr && <><div dangerouslySetInnerHTML={{ __html: qr }} /><div className="reg">{r.number}</div></>}

          {state === "registered" && e.status !== "cancelled" && (
            <>
              <div className="small" style={{ marginTop: 10, opacity: 0.7 }}>Show this at the door.</div>
              {e.startsAt && <a href={`/e/${e.slug}/calendar.ics`} className="small" style={{ display: "block", margin: "8px 0" }}>Add to your calendar</a>}
              {open && <form action={guestCancelAction}>{key}<button type="submit" className="quiet">I can no longer come</button></form>}
            </>
          )}

          {state === "waitlisted" && (
            <>
              <p style={{ margin: "0 0 4px" }}>Every place is taken for now. We will email you the moment one opens, and this page will turn into your pass.</p>
              <form action={guestCancelAction}>{key}<button type="submit" className="quiet">Take me off the waitlist</button></form>
            </>
          )}

          {(state === "invited" || state === "declined" || state === "cancelled") && (
            open ? (
              <form action={rsvpAction} className="stack">
                {key}
                {state !== "invited" && <p style={{ margin: 0 }}>{state === "declined" ? "You told us you cannot make it." : "Your place was cancelled."} Changed your mind?</p>}
                <FieldInputs fields={fields} />
                <button type="submit" name="answer" value="yes">Yes, I will be there</button>
                {state === "invited" && <button type="submit" name="answer" value="no" className="quiet" formNoValidate>Sorry, I cannot make it</button>}
              </form>
            ) : <p style={{ margin: 0 }}>Replies for this event are closed.</p>
          )}

          {state === "attended" && (
            <>
              <div className="small" style={{ marginTop: 14, opacity: 0.7 }}>Your check-in PIN</div>
              <div className="pin">{r.pin}</div>
              {thanks || answered ? <div className="notice good" style={{ marginTop: 18 }}>Thank you. Your answer{answered ? ` of ${answered.score}` : ""} is with the organisers.</div> : null}
              <form action={surveyAction} className="stack">
                {key}
                <label>How likely are you to recommend this event to a colleague?
                  <span className="scale">{Array.from({ length: 11 }, (_, n) => <label key={n}><input type="radio" name="score" value={n} required defaultChecked={answered?.score === n} /><span>{n}</span></label>)}</span></label>
                <label>Anything we should know? (optional)<textarea name="comment" rows={2} defaultValue={answered?.comment ?? ""} /></label>
                <button type="submit">{answered ? "Update my answer" : "Send"}</button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
