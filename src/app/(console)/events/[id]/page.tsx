import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, count, desc, eq, gt, ilike, inArray, min, or, sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { budgetItem, contact, event, eventSession, formField, lead, surveyResponse, registration, sessionSpeaker, sysJournal, sysOutbox, sysUser, task, type EventStatus, type RegistrationStatus } from "@/db/schema";
import {
  addFieldAction, addGuestAction, addSessionAction, addSpeakerAction, addTaskAction, budgetItemAction, campaignAction, cancelRegistrationAction, captureLeadAction,
  checkInAction, cloneEventAction, importGuestsAction, leadValueAction, removeBudgetAction, removeFieldAction, runAgentAction, setStatusAction, taskStateAction, updateEventAction, updateLocaleAction,
  bulkGuestsAction, cancelEventAction, decideGuestAction, undoCheckInAction, unscheduleAction, updateDetailsAction, updateEmailsAction, updateGuestAction,
} from "@/app/actions";
import { ago, countdown } from "@/lib/describe";
import { eventInsights, money } from "@/lib/insights";
import { can, requirePrincipal } from "@/lib/session";
import { formatWhen, isoToZonedLocal, timeZones } from "@/lib/when";
import { Denied } from "@/components/denied";


const NEXT_STATUS: Record<EventStatus, { status: EventStatus; label: string }[]> = {
  draft: [{ status: "live", label: "Go live" }],
  live: [{ status: "closed", label: "Close registration" }, { status: "draft", label: "Back to draft" }],
  closed: [{ status: "live", label: "Reopen" }, { status: "archived", label: "Archive" }],
  archived: [{ status: "closed", label: "Unarchive" }],
  cancelled: [{ status: "draft", label: "Reopen as a draft" }],
};
const GUEST_STATUS: Record<string, string> = { invited: "Awaiting reply", pending: "Awaiting approval", registered: "Registered", waitlisted: "On the waitlist", attended: "Checked in", declined: "Declined", cancelled: "Cancelled" };
const QUESTION: Record<string, string> = { text: "free text", checkbox: "tick box", phone: "phone number", company: "company name", website: "web address", social: "social profile", terms: "must agree" };
const KIND = { booth: "Booth", field: "Field event", conference: "Conference" } as const;
const PROMPTS = {
  Builder: "Plan this event from the brief and tell me what is missing",
  Analyst: "How is this event going, and what should we do next?",
  Outreach: "Remind everyone who has not checked in about the agenda",
};

export default async function EventPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ notice?: string; ok?: string; tab?: string; q?: string; status?: string; page?: string; edit?: string }> }) {
  const { id } = await params;
  const { notice, ok, tab: asked, q: asksFor = "", status: asksStatus = "", page: asksPage, edit } = await searchParams;
  // The guest table: what is searched for, which status is shown, and which page of 50.
  const PAGE = 50;
  const term = asksFor.trim().slice(0, 80);
  const only = Object.keys(GUEST_STATUS).includes(asksStatus) ? (asksStatus as RegistrationStatus) : null;
  const pageNo = Math.max(1, Math.floor(Number(asksPage)) || 1);
  const like = `%${term.replace(/[%_\\]/g, "\\$&")}%`;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const me = await requirePrincipal();
  if (!can(me, "event.read")) return <Denied title="Events" />;
  const db = await getDb();
  const [e] = await db.select().from(event).where(eq(event.id, id));
  if (!e) notFound();
  const wantsInsights = asked === "insights";
  // Everything the page shows is asked for at once, so the page waits for the slowest query, not for the sum of them.
  const guestWhere = and(
    eq(registration.eventId, id),
    term ? or(ilike(contact.firstName, like), ilike(contact.lastName, like), ilike(contact.email, like), ilike(registration.number, like)) : undefined,
    only ? eq(registration.status, only) : undefined,
  );
  const [fields, guests, sessions, leads, tasks, notes, messages, speakers, ins, budget, comments, [matching], scheduled, [editing]] = await Promise.all([
    db.select().from(formField).where(eq(formField.eventId, id)).orderBy(asc(formField.position)),
    db.select({ r: registration, c: contact }).from(registration).innerJoin(contact, eq(contact.id, registration.contactId))
      .where(guestWhere).orderBy(desc(registration.createdAt)).limit(PAGE).offset((pageNo - 1) * PAGE),
    db.select().from(eventSession).where(eq(eventSession.eventId, id)).orderBy(asc(eventSession.startsAt)),
    db.select({ l: lead, c: contact }).from(lead).innerJoin(contact, eq(contact.id, lead.contactId))
      .where(eq(lead.eventId, id)).orderBy(desc(lead.score), desc(lead.createdAt)),
    db.select().from(task).where(and(eq(task.eventId, id), eq(task.taskType, "task"))).orderBy(asc(task.createdAt)),
    db.select({ n: sysJournal, author: sysUser.name, kind: sysUser.kind }).from(sysJournal).leftJoin(sysUser, eq(sysUser.id, sysJournal.authorId))
      .where(and(eq(sysJournal.tableName, "event"), eq(sysJournal.recordId, id))).orderBy(desc(sysJournal.id)).limit(8),
    db.select().from(sysOutbox).where(eq(sysOutbox.eventId, id)).orderBy(desc(sysOutbox.createdAt)).limit(12),
    db.select({ sessionId: sessionSpeaker.sessionId, c: contact }).from(sessionSpeaker)
      .innerJoin(eventSession, eq(eventSession.id, sessionSpeaker.sessionId)).innerJoin(contact, eq(contact.id, sessionSpeaker.contactId)).where(eq(eventSession.eventId, id)),
    eventInsights(db, id, e),
    wantsInsights ? db.select().from(budgetItem).where(eq(budgetItem.eventId, id)).orderBy(asc(budgetItem.createdAt)) : [],
    wantsInsights ? db.select().from(surveyResponse).where(eq(surveyResponse.eventId, id)).orderBy(desc(surveyResponse.createdAt)).limit(6) : [],
    db.select({ n: count() }).from(registration).innerJoin(contact, eq(contact.id, registration.contactId)).where(guestWhere),
    // Messages held for later, one line per send rather than one per guest.
    db.select({ key: sql<string>`${sysOutbox.meta}->>'campaign'`, subject: min(sysOutbox.subject), at: min(sysOutbox.nextAttemptAt), n: count() }).from(sysOutbox)
      .where(and(eq(sysOutbox.eventId, id), eq(sysOutbox.status, "pending"), gt(sysOutbox.nextAttemptAt, new Date()), sql`${sysOutbox.meta}->>'campaign' is not null`))
      .groupBy(sql`${sysOutbox.meta}->>'campaign'`).orderBy(min(sysOutbox.nextAttemptAt)),
    edit && /^[0-9a-f-]{36}$/i.test(edit) ? db.select({ r: registration, c: contact }).from(registration).innerJoin(contact, eq(contact.id, registration.contactId)).where(and(eq(registration.id, edit), eq(registration.eventId, id))) : [],
  ]);

  // A tab a person's role does not include is not offered, and asking for it by address shows the overview instead.
  const tabs: { key: string; label: string; n?: number }[] = [
    { key: "overview", label: "Overview" },
    ...(can(me, "contact.read") ? [{ key: "guests", label: "Guests", n: ins.funnel.onList }] : []),
    ...(e.kind === "conference" ? [{ key: "agenda", label: "Agenda", n: sessions.length }] : []),
    ...(can(me, "contact.read") ? [{ key: "leads", label: "Leads", n: leads.length }] : []),
    ...(can(me, "message.send") ? [{ key: "messages", label: "Messages" }] : []),
    ...(can(me, "insights.read") ? [{ key: "insights", label: "Insights" }] : []),
    ...(can(me, "event.write") ? [{ key: "setup", label: "Setup" }] : []),
  ];
  const tab = tabs.some((t) => t.key === asked) ? asked! : "overview";
  // Where the guest table is now, so an action on it comes back to the same search, filter and page.
  const guestsAt = (page: number, extra = "") => `/events/${e.id}?tab=guests${term ? `&q=${encodeURIComponent(term)}` : ""}${only ? `&status=${only}` : ""}${page > 1 ? `&page=${page}` : ""}${extra}`;
  const here = tab === "guests" ? guestsAt(pageNo) : `/events/${e.id}${tab === "overview" ? "" : `?tab=${tab}`}`;
  const pages = Math.max(1, Math.ceil(matching.n / PAGE));
  const hidden = <><input type="hidden" name="eventId" value={e.id} /><input type="hidden" name="returnTo" value={here} /></>;
  const attended = ins.funnel.attended;
  const versus = (have: number, target: number | null) => target == null ? null : <span className={`vs ${have >= target ? "good" : "short"}`}>{have >= target ? "target met" : `${target - have} short of ${target}`}</span>;
  const awaiting = ins.funnel.awaitingReply;
  const toApprove = ins.funnel.awaitingApproval;
  const STATUS: Record<string, string> = { invited: "awaiting reply", pending: "awaiting approval", registered: "registered", waitlisted: "on the waitlist", declined: "declined", cancelled: "cancelled", attended: "checked in", no_show: "no show" };
  const hot = leads.filter((x) => x.l.band === "hot").length;
  const open = tasks.filter((t) => t.state !== "done" && t.state !== "cancelled");

  return (
    <>
      <div className="crumb"><Link href="/events">Events</Link> / {e.number}</div>
      <div className="head">
        <div>
          <h1>{e.name}</h1>
          <p className="muted">
            <span className={`pill ${e.status}`}>{e.status}</span>{" "}
            {KIND[e.kind]}, {formatWhen(e.startsAt, e.timezone)}{e.venue ? `, ${e.venue}` : ""} ({countdown(e.startsAt)})
          </p>
        </div>
        <div className="actions">
          {can(me, "checkin.write") && <Link className="button" href={`/events/${e.id}/desk`}>Door desk</Link>}
          {can(me, "lead.write") && <Link className="button" href={`/events/${e.id}/capture`}>Capture a lead</Link>}
          {can(me, "event.publish") && NEXT_STATUS[e.status].slice(0, 1).map((n) => (
            <form key={n.status} action={setStatusAction}>{hidden}<input type="hidden" name="status" value={n.status} /><button type="submit">{n.label}</button></form>
          ))}
        </div>
      </div>
      {notice && <div className="notice">{notice}</div>}
      {ok && <div className="notice good">{ok}</div>}

      <nav className="tabs" aria-label="Sections">
        {tabs.map((t) => <Link key={t.key} href={`/events/${e.id}${t.key === "overview" ? "" : `?tab=${t.key}`}`} className={t.key === tab ? "on" : ""}>{t.label}{t.n ? <small>{t.n}</small> : null}</Link>)}
      </nav>

      {tab === "overview" && (
        <>
          <div className="stats">
            <div className="stat"><b>{ins.funnel.registered}{e.capacity ? <em> of {e.capacity} places</em> : null}</b><span>Registered {versus(ins.funnel.registered, e.targetRegistrations)}</span></div>
            <div className="stat"><b>{attended} <em>of {ins.funnel.registered}</em></b><span>Checked in</span><div className="meter"><i style={{ width: `${ins.funnel.registered ? (attended / ins.funnel.registered) * 100 : 0}%` }} /></div></div>
            <div className="stat"><b>{leads.length}</b><span>Leads {versus(leads.length, e.targetLeads)}</span></div>
            <div className="stat"><b>{hot}</b><span>Hot leads</span></div>
            {can(me, "insights.read") && <div className="stat"><b>{ins.money.pipeline ? money(ins.money.pipeline, ins.currency) : "–"}</b><span>Pipeline</span></div>}
            <div className="stat"><b>{open.length}</b><span>Open to-dos</span></div>
          </div>
          <div className="cols">
            <section className="section">
              {can(me, "agent.run") && <><h2>Ask an agent</h2>
              <form action={runAgentAction} className="stack">
                {hidden}
                <textarea name="goal" required minLength={5} placeholder={PROMPTS.Builder} />
                <div className="actions">
                  <select name="agent" defaultValue="Builder" style={{ width: "auto" }} aria-label="Agent">
                    <option value="Builder">Builder: plans and sets up</option><option value="Analyst">Analyst: reports how it is going</option><option value="Outreach">Outreach: writes to guests</option>
                  </select>
                  <button type="submit" className="mint">Start</button>
                </div>
                <p className="small faint" style={{ margin: 0 }}>Agents work in the background and record every step. Anything they want to send outside the team waits for your approval.</p>
              </form></>}
              {e.brief && <><h2 style={{ marginTop: can(me, "agent.run") ? 30 : 0 }}>Brief</h2><p className="muted" style={{ margin: 0 }}>{e.brief}</p></>}
              <h2 style={{ marginTop: 30 }}>Notes</h2>
              {notes.length === 0 ? <div className="empty">No notes yet. Agents leave their plans and briefs here.</div> : notes.map(({ n, author, kind }) => (
                <div className={`note ${kind === "agent" ? "agent" : ""}`} key={n.id}><div className="small"><span className={`who ${kind}`}>{author ?? "Someone"}</span> <span className="faint">{ago(n.at)}</span></div>{n.body}</div>
              ))}
            </section>
            <section className="section">
              <h2>To-dos <small>{open.length} open</small></h2>
              <form action={addTaskAction} className="row" style={{ marginBottom: 8 }}>
                {hidden}<input name="shortDescription" required minLength={2} placeholder="Add a to-do" aria-label="New to-do" style={{ flex: 1 }} /><button type="submit" className="ghost">Add</button>
              </form>
              {tasks.length === 0 ? <div className="empty">Nothing to do yet.</div> : (
                <div className="feed">{tasks.map((t) => (
                  <div key={t.id} style={{ alignItems: "center" }}>
                    <span style={t.state === "done" ? { textDecoration: "line-through", color: "var(--faint)" } : undefined}>{t.shortDescription}{t.description && <span className="small muted" style={{ display: "block" }}>{t.description}</span>}</span>
                    <form action={taskStateAction} style={{ marginLeft: "auto" }}>{hidden}<input type="hidden" name="taskId" value={t.id} /><input type="hidden" name="state" value={t.state === "done" ? "open" : "done"} />
                      <button className="ghost" type="submit">{t.state === "done" ? "Reopen" : "Done"}</button></form>
                  </div>
                ))}</div>
              )}
            </section>
          </div>
        </>
      )}

      {tab === "guests" && (
        <>
          <div className="toolbar">
            <details className="add">
              <summary>+ Add a guest</summary>
              <form action={addGuestAction} className="row">
                {hidden}
                <label>First name<input name="firstName" required /></label>
                <label>Last name<input name="lastName" /></label>
                <label>Email<input name="email" type="email" required /></label>
                <label>Phone<input name="phone" placeholder="+919876543210" /></label>
                <label className="check"><input type="checkbox" name="whatsappOptIn" /> WhatsApp opt-in</label>
                <button type="submit">Add guest</button>
              </form>
            </details>
            <details className="add">
              <summary>+ Import a list</summary>
              <form action={importGuestsAction} className="stack">
                {hidden}
                <label>Paste from a spreadsheet: email, first name, last name, job title, phone. One person per line. A header row is fine.
                  <textarea name="list" required rows={6} placeholder={"email,first name,last name,job title\npriya@northwind.example,Priya,Nair,CIO"} /></label>
                <div className="actions"><button type="submit">Add to the guest list</button><span className="small faint">They are added as invited. Nobody is emailed until you send invitations.</span></div>
              </form>
            </details>
            {awaiting > 0 && (
              <details className="add">
                <summary>Send invitations to {awaiting}</summary>
                <form action={campaignAction} className="stack">
                  {hidden}<input type="hidden" name="segment" value="invited" /><input type="hidden" name="channel" value="email" /><input type="hidden" name="key" value="invitation" />
                  <label>Subject<input name="subject" required defaultValue={`You're invited: ${e.name}`} /></label>
                  <label>Message<textarea name="body" required rows={8} defaultValue={`Hi {{first_name}},\n\nWe would like to invite you to {{event_name}}${e.venue ? ` at ${e.venue}` : ""}.\n\nPlease let us know if you can join us:\n{{rsvp_url}}`} /></label>
                  <div className="actions"><button type="submit">Send invitations</button><span className="small faint">Each guest gets their own reply link. Pressing this again only reaches people added since.</span></div>
                </form>
              </details>
            )}
            <span style={{ flex: 1 }} />
            <Link className="button" href={`/events/${e.id}/badges`} target="_blank">Print badges</Link>
            <a className="button" href={`/events/${e.id}/export`}>Export CSV</a>
          </div>
          {toApprove > 0 && <div className="notice quiet" style={{ borderColor: "var(--amber)", color: "var(--amber)" }}>{toApprove} {toApprove === 1 ? "guest is" : "guests are"} waiting for your approval.</div>}
          {editing && can(me, "contact.write") && (
            <form action={updateGuestAction} className="card" style={{ marginBottom: 18 }}>
              {hidden}<input type="hidden" name="contactId" value={editing.c.id} />
              <h2>Correct {editing.c.firstName}'s details</h2>
              <div className="row" style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                <label>First name<input name="firstName" required maxLength={80} defaultValue={editing.c.firstName} /></label>
                <label>Last name<input name="lastName" maxLength={80} defaultValue={editing.c.lastName ?? ""} /></label>
                <label style={{ flexBasis: 240 }}>Email<input name="email" type="email" required defaultValue={editing.c.email} /></label>
                <label>Phone<input name="phone" placeholder="+919876543210" defaultValue={editing.c.phone ?? ""} /></label>
                <label>Job title<input name="title" maxLength={120} defaultValue={editing.c.title ?? ""} /></label>
              </div>
              <div className="actions" style={{ marginTop: 12 }}><button type="submit">Save</button><Link href={here}>Close</Link><span className="small faint">One person is one record: the change shows on every event they are part of.</span></div>
            </form>
          )}
          {ins.funnel.onList > 0 && (
            <div className="toolbar">
              <form method="get" className="actions" style={{ flex: 1 }}>
                <input type="hidden" name="tab" value="guests" />
                <input name="q" defaultValue={term} placeholder="Name, email or pass number" aria-label="Search guests" style={{ maxWidth: 260 }} />
                <select name="status" defaultValue={only ?? ""} aria-label="Show" style={{ width: "auto" }}><option value="">Everyone</option>{Object.entries(GUEST_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
                <button type="submit" className="ghost">Show</button>
                {(term || only) && <Link href={`/events/${e.id}?tab=guests`} className="small">Clear</Link>}
                <span className="small muted">{matching.n === ins.funnel.onList ? `${matching.n} on the list` : `${matching.n} of ${ins.funnel.onList}`}</span>
              </form>
              <form id="bulk" action={bulkGuestsAction} className="actions">
                {hidden}
                <select name="bulk" defaultValue="" aria-label="With the ticked guests" style={{ width: "auto" }}><option value="" disabled>With the ticked guests…</option><option value="approve">Approve</option><option value="decline">Turn down</option><option value="check_in">Check in</option><option value="cancel">Cancel their place</option></select>
                <button type="submit" className="ghost">Apply</button>
              </form>
            </div>
          )}
          {ins.funnel.onList === 0 ? <div className="empty">Nobody has registered yet. Share the public page from Setup, or add guests here.</div> : guests.length === 0 ? <div className="empty">Nobody matches that.</div> : (
            <table>
              <thead><tr><th style={{ width: 28 }}><span className="faint small">Tick</span></th><th>Guest</th><th>Status</th><th>Came from</th><th>Pass</th><th></th></tr></thead>
              <tbody>
                {guests.map(({ r, c }) => (
                  <tr key={r.id}>
                    <td><input type="checkbox" name="ids" value={r.id} form="bulk" aria-label={`Select ${c.firstName} ${c.lastName ?? ""}`} style={{ width: "auto" }} /></td>
                    <td>{c.firstName} {c.lastName}{can(me, "contact.write") && <> <Link className="small" href={guestsAt(pageNo, `&edit=${r.id}`)}>Edit</Link></>}<span className="sub">{c.email}</span></td>
                    <td><span className={`pill ${r.checkedInAt ? "attended" : r.status === "waitlisted" || r.status === "invited" || r.status === "pending" ? "held" : r.status === "declined" || r.status === "cancelled" ? "" : r.status}`}>{STATUS[r.checkedInAt ? "attended" : r.status]}</span></td>
                    <td className="muted">{r.source === "web" ? "Public page" : r.source === "staff" ? "Added by staff" : r.source === "import" ? "Guest list" : r.source}</td>
                    <td><Link href={`/e/${e.slug}/pass/${r.id}`} target="_blank">{r.number}</Link>{r.pin && <span className="sub">PIN {r.pin}</span>}</td>
                    <td style={{ textAlign: "right" }}>
                      {r.status === "pending" && can(me, "registration.write") && (
                        <form action={decideGuestAction} className="actions" style={{ justifyContent: "flex-end" }}>
                          {hidden}<input type="hidden" name="registrationId" value={r.id} />
                          <button className="link" type="submit" name="decision" value="decline">Turn down</button>
                          <button className="amber" type="submit" name="decision" value="approve">Approve</button>
                        </form>
                      )}
                      {r.checkedInAt && can(me, "checkin.write") && (
                        <form action={undoCheckInAction}>{hidden}<input type="hidden" name="registrationId" value={r.id} /><button className="link" type="submit">Undo check-in</button></form>
                      )}
                      {r.status === "registered" && !r.checkedInAt && (
                        <div className="actions" style={{ justifyContent: "flex-end" }}>
                          <form action={cancelRegistrationAction}>{hidden}<input type="hidden" name="registrationId" value={r.id} /><button className="link" type="submit">Cancel</button></form>
                          <form action={checkInAction}>{hidden}<input type="hidden" name="registrationId" value={r.id} /><button className="ghost" type="submit">Check in</button></form>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {pages > 1 && (
            <div className="actions" style={{ marginTop: 14 }}>
              {pageNo > 1 ? <Link className="button" href={guestsAt(pageNo - 1)}>Previous</Link> : null}
              <span className="small muted">Page {Math.min(pageNo, pages)} of {pages}</span>
              {pageNo < pages ? <Link className="button" href={guestsAt(pageNo + 1)}>Next</Link> : null}
            </div>
          )}
        </>
      )}

      {tab === "agenda" && (
        <>
          <div className="toolbar">
            <details className="add">
              <summary>+ Add a session</summary>
              <form action={addSessionAction} className="row">
                {hidden}<input type="hidden" name="timezone" value={e.timezone} />
                <label style={{ flexBasis: 280 }}>Title<input name="title" required minLength={2} /></label>
                <label>Track<input name="track" /></label><label>Room<input name="room" /></label>
                <label>Starts<input name="startsAt" type="datetime-local" /></label>
                <button type="submit">Add session</button>
              </form>
            </details>
            {sessions.length > 0 && (
              <details className="add">
                <summary>+ Add a speaker</summary>
                <form action={addSpeakerAction} className="row">
                  {hidden}
                  <label>Session<select name="sessionId">{sessions.map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}</select></label>
                  <label>First name<input name="firstName" required /></label><label>Last name<input name="lastName" /></label>
                  <label>Email<input name="email" type="email" required /></label><label>Job title<input name="title" /></label>
                  <button type="submit">Add speaker</button>
                </form>
              </details>
            )}
          </div>
          {sessions.length === 0 ? <div className="empty">No sessions yet. Add the first, or ask Builder to draft an agenda from the brief.</div> : (
            <div className="rows">{sessions.map((s) => {
              const who = speakers.filter((x) => x.sessionId === s.id);
              return (
                <div className="rowitem" key={s.id}>
                  <div className="datebox"><b>{s.startsAt ? new Intl.DateTimeFormat("en-IN", { hour: "numeric", minute: "2-digit", hour12: false, timeZone: e.timezone }).format(s.startsAt) : "?"}</b></div>
                  <div><div className="title">{s.title}</div><div className="small muted">{who.length ? who.map((x) => `${x.c.firstName} ${x.c.lastName ?? ""}${x.c.title ? `, ${x.c.title}` : ""}`.trim()).join("; ") : "No speaker yet"}</div></div>
                  <div className="actions">{s.track && <span className="pill">{s.track}</span>}{s.room && <span className="small muted">{s.room}</span>}</div>
                </div>
              );
            })}</div>
          )}
        </>
      )}

      {tab === "leads" && (
        <>
          {can(me, "lead.write") && <div className="toolbar">
            <details className="add">
              <summary>+ Capture a lead</summary>
              <form action={captureLeadAction} className="row">
                {hidden}
                <label>First name<input name="firstName" required /></label><label>Last name<input name="lastName" /></label>
                <label>Email<input name="email" type="email" required /></label>
                <label style={{ flexBasis: 320 }}>What did you talk about?<input name="notes" /></label>
                <button type="submit">Capture lead</button>
              </form>
            </details>
            <Link className="button" href={`/events/${e.id}/capture`}>Open the phone screen</Link>
          </div>}
          {leads.length === 0 ? <div className="empty">No leads yet. On the stand, use Capture a lead on a phone.</div> : (
            <div className="rows">{leads.map(({ l, c }) => (
              <div className="rowitem" key={l.id}>
                <div className="datebox">{l.score != null ? <><b>{l.score}</b><span>score</span></> : <span>Not scored</span>}</div>
                <div><div className="title">{c.firstName} {c.lastName}{c.title ? <span className="muted" style={{ fontWeight: 400 }}>, {c.title}</span> : null}</div><div className="small muted">{l.notes}</div></div>
                <div className="actions">
                  {l.band && <span className={`pill ${l.band}`}>{l.band}</span>}
                  {can(me, "lead.write") && <form action={leadValueAction} className="actions">{hidden}<input type="hidden" name="leadId" value={l.id} />
                    <input name="pipelineValue" type="number" min={0} step={1000} defaultValue={l.pipelineValue ?? ""} placeholder={`Worth, ${e.currency}`} aria-label="What this lead could be worth" style={{ width: 140 }} />
                    <button className="ghost" type="submit">Save</button></form>}
                </div>
              </div>
            ))}</div>
          )}
        </>
      )}

      {tab === "messages" && (
        <div className="cols">
          <section className="section">
            <h2>Write to guests</h2>
            <form action={campaignAction} className="stack">
              {hidden}
              <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                <label>To<select name="segment" defaultValue="all"><option value="all">Everyone registered</option><option value="not_checked_in">Not checked in yet</option><option value="checked_in">Checked in</option><option value="invited">Invited, not registered</option></select></label>
                <label>By<select name="channel" defaultValue="email"><option value="email">Email</option><option value="whatsapp">WhatsApp</option></select></label>
              </div>
              <label>Subject, for email<input name="subject" maxLength={200} /></label>
              <label>Message<textarea name="body" required style={{ minHeight: 150 }} placeholder={"Hi {{first_name}},\n\nA quick update about {{event_name}}.\n\nYour pass: {{pass_url}}"} /></label>
              <input type="hidden" name="timezone" value={e.timezone} />
              <label>Send at (optional)<input name="sendAt" type="datetime-local" /></label>
              <div className="actions"><button type="submit">Send</button><span className="small faint">Leave the time empty to send now. Times are in {e.timezone}. Guests without consent for the channel are skipped.</span></div>
            </form>
            {scheduled.length > 0 && (
              <>
                <h2 style={{ marginTop: 26 }}>Waiting to go out</h2>
                <div className="feed">{scheduled.map((s) => (
                  <div key={s.key} style={{ alignItems: "center" }}>
                    <span><span style={{ fontWeight: 500 }}>{s.subject ?? "WhatsApp message"}</span><span className="small muted" style={{ display: "block" }}>{s.n} {s.n === 1 ? "guest" : "guests"}, {formatWhen(s.at, e.timezone)}</span></span>
                    <form action={unscheduleAction} style={{ marginLeft: "auto" }}>{hidden}<input type="hidden" name="key" value={s.key} /><button className="ghost" type="submit">Stop</button></form>
                  </div>
                ))}</div>
              </>
            )}
          </section>
          <section className="section">
            <h2>Recently sent <small>for this event</small></h2>
            {messages.length === 0 ? <div className="empty">Nothing sent yet. Confirmations and reminders go out on their own.</div> : (
              <div className="feed">{messages.map((m) => (
                <div key={m.id}><span><span style={{ fontWeight: 500 }}>{m.subject ?? "WhatsApp message"}</span><span className="small muted" style={{ display: "block" }}>{m.recipient}</span></span><span className={`pill ${m.status}`} style={{ marginLeft: "auto" }}>{m.status}</span></div>
              ))}</div>
            )}
          </section>
        </div>
      )}

      {tab === "insights" && (
        <>
          <div className="stats">
            <div className="stat"><b>{money(ins.money.actual ?? ins.money.planned, ins.currency)}</b><span>{ins.money.actual != null ? "Spent so far" : "Planned cost"}</span></div>
            <div className="stat"><b>{money(ins.money.costPerAttendee, ins.currency)}</b><span>Cost per attendee</span></div>
            <div className="stat"><b>{money(ins.money.costPerLead, ins.currency)}</b><span>Cost per lead</span></div>
            <div className="stat"><b>{ins.money.pipeline ? money(ins.money.pipeline, ins.currency) : "–"}</b><span>Pipeline from leads</span></div>
            <div className="stat"><b>{ins.money.pipelinePerUnitSpent != null ? `${ins.money.pipelinePerUnitSpent}×` : "–"}</b><span>Pipeline for each {ins.currency} spent</span></div>
            <div className="stat"><b>{ins.nps ? ins.nps.score : "–"}</b><span>Guest score (NPS){ins.nps ? `, ${ins.nps.responses} ${ins.nps.responses === 1 ? "answer" : "answers"}` : ""}</span></div>
          </div>
          <div className="cols">
            <section className="section">
              <h2>From list to lead</h2>
              {(() => {
                const top = Math.max(ins.funnel.onList, ins.funnel.registered, ins.leads.total, 1);
                const rows: [string, number, string][] = [["On the guest list", ins.funnel.onList, ""], ["Registered", ins.funnel.registered, ""], ["Checked in", ins.funnel.attended, "mint"], ["Leads", ins.leads.total, "mint"], ["Hot leads", ins.leads.hot, "mint"]];
                return <div className="funnel">{rows.map(([label, n, tone]) => <div key={label}><span className="muted">{label}</span><span className={`bar ${tone}`}><i style={{ width: `${(n / top) * 100}%` }} /></span><b>{n}</b></div>)}</div>;
              })()}
              <p className="small muted">
                {ins.showRate != null ? `${ins.showRate}% of registered guests checked in. ` : ""}
                {ins.funnel.awaitingReply > 0 ? `${ins.funnel.awaitingReply} have not replied. ` : ""}{ins.funnel.waitlisted > 0 ? `${ins.funnel.waitlisted} on the waitlist. ` : ""}
                {ins.funnel.declined + ins.funnel.cancelled > 0 ? `${ins.funnel.declined} declined, ${ins.funnel.cancelled} cancelled.` : ""}
              </p>
              {comments.length > 0 && <><h2 style={{ marginTop: 26 }}>What guests said</h2>{comments.filter((c) => c.comment).map((c) => <div className="note" key={c.id}><span className="small faint">Score {c.score}</span>{"\n"}{c.comment}</div>)}</>}
            </section>
            <section className="section">
              <h2>Budget <small>{money(ins.money.planned, ins.currency)} planned</small></h2>
              <table>
                <thead><tr><th>Line</th><th className="num">Planned</th><th className="num">Actual</th><th></th></tr></thead>
                <tbody>
                  {budget.map((b) => (
                    <tr key={b.id}>
                      <td>{b.label}</td><td className="num">{money(b.planned, ins.currency)}</td>
                      <td className="num">
                        <form action={budgetItemAction} className="actions" style={{ justifyContent: "flex-end" }}>{hidden}<input type="hidden" name="itemId" value={b.id} /><input type="hidden" name="label" value={b.label} /><input type="hidden" name="planned" value={b.planned} />
                          <input name="actual" type="number" min={0} defaultValue={b.actual ?? ""} placeholder="Not yet" aria-label={`Actual cost of ${b.label}`} /><button className="ghost" type="submit">Save</button></form>
                      </td>
                      <td><form action={removeBudgetAction}>{hidden}<input type="hidden" name="itemId" value={b.id} /><button className="link" type="submit">Remove</button></form></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <form action={budgetItemAction} className="row" style={{ marginTop: 14 }}>
                {hidden}<label>New line<input name="label" required minLength={2} placeholder="Venue hire" /></label>
                <label style={{ flexBasis: 120 }}>Planned, {ins.currency}<input name="planned" type="number" min={0} required /></label><button type="submit" className="ghost">Add</button>
              </form>
              <p className="small faint">Pipeline is the total of the "worth" figures your team enters on the Leads tab. Nothing here is estimated by an agent.</p>
            </section>
          </div>
        </>
      )}

      {tab === "setup" && (
        <div className="cols">
          <section className="section">
            <h2>Questions <small>beyond name, email and phone</small></h2>
            <details className="add">
              <summary>+ Add a question</summary>
              <form action={addFieldAction} className="row">
                {hidden}
                <label>Ask it on<select name="purpose" defaultValue="registration"><option value="registration">The registration form</option><option value="lead">The lead capture screen</option></select></label>
                <label>Question<input name="label" required minLength={2} placeholder="Company" /></label>
                <label>Answer<select name="type" defaultValue="text"><option value="text">Free text</option><option value="select">Choose one</option><option value="checkbox">Tick box</option><option value="company">Company</option><option value="phone">Phone number</option><option value="website">Web address</option><option value="social">Social profile</option><option value="terms">Terms they must agree to</option></select></label>
                <label>Choices, separated by commas<input name="options" placeholder="Only for Choose one" /></label>
                <label className="check"><input type="checkbox" name="required" /> Required</label>
                <button type="submit">Add question</button>
              </form>
            </details>
            {fields.length === 0 ? <div className="empty">No extra questions.</div> : (
              <div className="feed">{fields.map((f) => (
                <div key={f.id} style={{ alignItems: "center" }}>
                  <span><span style={{ fontWeight: 500 }}>{f.label}</span>{f.required && <span className="small faint"> (required)</span>}
                    <span className="small muted" style={{ display: "block" }}>{f.purpose === "lead" ? "Lead capture" : "Registration form"}, {f.type === "select" ? `choose one of ${f.options.join(", ")}` : QUESTION[f.type] ?? f.type}</span></span>
                  <form action={removeFieldAction} style={{ marginLeft: "auto" }}>{hidden}<input type="hidden" name="fieldId" value={f.id} /><button className="ghost" type="submit">Remove</button></form>
                </div>
              ))}</div>
            )}
          </section>
          <section className="section">
            <h2>Details</h2>
            <form action={updateDetailsAction} className="stack" style={{ marginBottom: 26 }}>
              {hidden}<input type="hidden" name="timezone" value={e.timezone} />
              <label>Name<input name="name" required minLength={2} maxLength={120} defaultValue={e.name} /></label>
              <div className="row" style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                <label>Starts<input name="startsAt" type="datetime-local" defaultValue={isoToZonedLocal(e.startsAt, e.timezone)} /></label>
                <label>Ends<input name="endsAt" type="datetime-local" defaultValue={isoToZonedLocal(e.endsAt, e.timezone)} /></label>
              </div>
              <label>Hosted by (optional)<input name="hostName" maxLength={120} defaultValue={e.hostName ?? ""} placeholder="Your company or team, as guests should read it" /></label>
              <label>Venue<input name="venue" maxLength={200} defaultValue={e.venue ?? ""} /></label>
              <label>Link to a map of the venue (optional)<input name="locationUrl" type="url" placeholder="https://maps.app.goo.gl/…" defaultValue={e.locationUrl ?? ""} /></label>
              <label>What guests read on the public page<textarea name="description" rows={6} maxLength={10000} defaultValue={e.description ?? ""} placeholder="What the event is, who it is for and what will happen. A blank line starts a new paragraph." /></label>
              <label>Cover picture, as a web address (optional)<input name="coverImageUrl" type="url" placeholder="https://…/cover.jpg" defaultValue={e.coverImageUrl ?? ""} /></label>
              <label>Brief for the team and the agents. Never shown to guests.<textarea name="brief" rows={3} maxLength={4000} defaultValue={e.brief ?? ""} /></label>
              <label>Address of the public page<span className="small faint"> /e/</span><input name="slug" required pattern="[a-z0-9]+(-[a-z0-9]+)*" minLength={3} maxLength={60} defaultValue={e.slug} /></label>
              <div className="actions"><button type="submit" className="ghost">Save details</button><span className="small faint">Times are in {e.timezone}. Changing the address breaks links already sent to guests.</span></div>
            </form>
            <h2>Places and targets</h2>
            <form action={updateEventAction} className="row" style={{ marginBottom: 26 }}>
              {hidden}
              <label>Places available<input name="capacity" type="number" min={1} defaultValue={e.capacity ?? ""} placeholder="No limit" /></label>
              <label>Registration target<input name="targetRegistrations" type="number" min={1} defaultValue={e.targetRegistrations ?? ""} /></label>
              <label>Lead target<input name="targetLeads" type="number" min={1} defaultValue={e.targetLeads ?? ""} /></label>
              <label className="check"><input type="checkbox" name="requireApproval" defaultChecked={e.requireApproval} /> Approve each guest before they get a place</label>
              <button type="submit" className="ghost">Save</button>
            </form>
            <p className="small faint" style={{ marginTop: -14 }}>When every place is taken, new guests join a waitlist and are moved up automatically when someone cancels.</p>
            <h2>Emails that go out on their own</h2>
            <form action={updateEmailsAction} className="stack" style={{ marginBottom: 26 }}>
              {hidden}
              <label className="check"><input type="checkbox" name="reminders" defaultChecked={e.reminders} /> Remind guests a day before and an hour before</label>
              <label className="check"><input type="checkbox" name="feedbackEmail" defaultChecked={e.feedbackEmail} /> Afterwards, ask everyone who came how it was</label>
              <label>A note added to every confirmation email (optional)<textarea name="confirmationNote" rows={3} maxLength={2000} defaultValue={e.confirmationNote ?? ""} placeholder="Parking, dress code, who to ask for at reception." /></label>
              <div><button type="submit" className="ghost">Save</button></div>
            </form>
            <h2>Time zone and currency</h2>
            <form action={updateLocaleAction} className="row" style={{ marginBottom: 26 }}>
              {hidden}
              <label>Time zone<select name="timezone" defaultValue={e.timezone}>{timeZones(e.timezone).map((z) => <option key={z}>{z}</option>)}</select></label>
              <label>Currency<input name="currency" defaultValue={e.currency} required minLength={3} maxLength={3} pattern="[A-Za-z]{3}" style={{ width: 90, textTransform: "uppercase" }} /></label>
              <button type="submit" className="ghost">Save</button>
            </form>
            <p className="small faint" style={{ marginTop: -14 }}>Times are shown in this zone on the public page, passes and emails. Changing it does not move the event. Budgets and pipeline are shown in this currency.</p>
            <h2>Run it again</h2>
            <form action={cloneEventAction} className="row" style={{ marginBottom: 26 }}>
              {hidden}
              <label>Name of the new event<input name="name" required minLength={2} placeholder={`${e.name} (next edition)`} /></label>
              <label>Starts<input name="startsAt" type="datetime-local" /></label>
              <button type="submit" className="ghost">Create a copy</button>
            </form>
            <p className="small faint" style={{ marginTop: -14 }}>Copies the setup: questions, session outline, planned budget, places and targets. Guests and leads are not copied.</p>
            <h2>Public page</h2>
            <p className="muted" style={{ marginTop: 0 }}>{e.status === "live" ? "Open for registration at" : "Opens for registration when the event is live:"} <Link href={`/e/${e.slug}`} target="_blank">/e/{e.slug}</Link></p>
            <h2 style={{ marginTop: 26 }}>Status</h2>
            <div className="actions">
              {NEXT_STATUS[e.status].map((n, i) => (
                <form key={n.status} action={setStatusAction}>{hidden}<input type="hidden" name="status" value={n.status} /><button type="submit" className={i === 0 ? "" : "ghost"}>{n.label}</button></form>
              ))}
            </div>
            {e.status !== "cancelled" && can(me, "event.publish") && (
              <details className="add" style={{ marginTop: 18 }}>
                <summary>Cancel this event</summary>
                <form action={cancelEventAction} className="stack">
                  {hidden}
                  <label>A note for guests (optional)<textarea name="message" rows={3} maxLength={2000} placeholder="What happens next, for example a new date or who to contact." /></label>
                  <label className="check"><input type="checkbox" name="confirm" required /> Call the event off, shut registration and email everyone invited, registered or waiting.</label>
                  <div><button type="submit" className="ghost">Cancel the event</button></div>
                </form>
              </details>
            )}
          </section>
        </div>
      )}
    </>
  );
}
