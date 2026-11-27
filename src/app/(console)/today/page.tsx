import Link from "next/link";
import { and, asc, count, desc, eq, inArray, ne } from "drizzle-orm";
import { getDb } from "@/db/client";
import { event, registration, sysAudit, sysUser, task } from "@/db/schema";
import { Intent } from "@/components/intent";
import { ago, countdown, initials, sentence } from "@/lib/describe";
import { can, requirePrincipal } from "@/lib/session";
import { DEFAULT_TIMEZONE } from "@/lib/when";
import { Denied } from "@/components/denied";


const DAY = 86_400_000;

export default async function Today() {
  const me = await requirePrincipal();
  if (!can(me, "event.read")) return <Denied title="Today" />;
  const decides = can(me, "approval.decide"), seesLedger = can(me, "audit.read");
  const db = await getDb();
  const [events, approvals, ledger, runs, [{ n: waiting }]] = await Promise.all([
    db.select({ e: event, guests: count(registration.id) }).from(event).leftJoin(registration, eq(registration.eventId, event.id))
      .where(ne(event.status, "archived")).groupBy(event.id).orderBy(asc(event.startsAt)),
    // What a person's role does not let them see is not read at all.
    db.select({ t: task, by: sysUser.name }).from(task).leftJoin(sysUser, eq(sysUser.id, task.createdBy))
      .where(and(eq(task.taskType, "approval"), eq(task.state, "awaiting_approval"))).orderBy(desc(task.createdAt)).limit(decides ? 3 : 0),
    db.select({ a: sysAudit, name: sysUser.name }).from(sysAudit).leftJoin(sysUser, eq(sysUser.id, sysAudit.actorId))
      .where(and(inArray(sysAudit.status, ["ok", "held"]), inArray(sysAudit.actorKind, ["agent", "service"]))).orderBy(desc(sysAudit.id)).limit(seesLedger ? 60 : 0),
    db.select().from(task).where(and(eq(task.taskType, "agent_run"), inArray(task.state, ["open", "in_progress"]))),
    db.select({ n: count() }).from(task).where(and(eq(task.taskType, "approval"), eq(task.state, "awaiting_approval"))),
  ]);
  const now = Date.now();
  // Fold repeats ("System sent a confirmation" twelve times) into one line with a count.
  const feed: { key: number; kind: string; name: string; text: string; at: Date; times: number }[] = [];
  for (const { a, name } of ledger) {
    const text = sentence(a.tool, a.input, a.status);
    const same = feed.find((f) => f.name === name && f.text === text);
    if (same) same.times++;
    else if (feed.length < 8) feed.push({ key: a.id, kind: a.actorKind, name: name ?? "?", text, at: a.at, times: 1 });
  }
  const live = events.filter((x) => x.e.status === "live").length;

  // The season: from a week ago to the furthest event, at least six weeks out.
  const dated = events.filter((x) => x.e.startsAt);
  const from = now - 7 * DAY;
  const to = Math.max(now + 42 * DAY, ...dated.map((x) => x.e.startsAt!.getTime() + 5 * DAY));
  const at = (t: number) => `${Math.min(97, Math.max(3, ((t - from) / (to - from)) * 100))}%`;
  const months = [];
  for (let d = new Date(from); d.getTime() < to; d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) {
    const first = new Date(d.getFullYear(), d.getMonth() + 1, 1);
    if (first.getTime() < to) months.push(first);
  }

  return (
    <>
      <div className="head">
        <div>
          <h1>{new Intl.DateTimeFormat("en-IN", { weekday: "long", day: "numeric", month: "long", timeZone: DEFAULT_TIMEZONE }).format(now)}</h1>
          <p className="muted">
            {me.name.split(" ")[0]}, {live === 0 ? "nothing is live right now" : `${live} ${live === 1 ? "event is" : "events are"} live`}
            {decides && waiting > 0 ? ` and ${waiting} ${waiting === 1 ? "action is" : "actions are"} waiting for your decision.` : "."}
          </p>
        </div>
        {can(me, "event.write") && <Link className="button" href="/events">New event</Link>}
      </div>

      {dated.length > 0 && (
        <div className="season" aria-label="Events over time">
          <div className="today" style={{ left: at(now) }}><span>Today</span></div>
          {months.map((m) => <span key={m.getTime()} className="tick" style={{ left: at(m.getTime()) }}>{new Intl.DateTimeFormat("en-IN", { month: "short" }).format(m)}</span>)}
          {dated.map(({ e, guests }, i) => (
            <Link key={e.id} href={`/events/${e.id}`} className={e.status} style={{ left: at(e.startsAt!.getTime()), ["--stem" as string]: `${16 + (i % 3) * 40}px` }}>
              <b>{e.name}</b><span>{countdown(e.startsAt, now)} · {guests} registered</span><i />
            </Link>
          ))}
        </div>
      )}

      <div className="cols">
        {decides && <section className="section">
          <h2>Needs you <small>{waiting === 0 ? "nothing waiting" : `${waiting} waiting`}</small></h2>
          {approvals.length === 0 ? (
            <div className="notice quiet">You are up to date. When an agent wants to send something outside the team, it appears here first.</div>
          ) : approvals.map(({ t, by }) => <Intent key={t.id} db={db} approval={t} agent={by ?? "An agent"} compact />)}
          {waiting > approvals.length && <Link href="/inbox">See all {waiting} in the Inbox</Link>}
        </section>}

        {seesLedger && <section className="section">
          <h2>Done for you <small>by agents and automatic rules</small></h2>
          {runs.map((r) => (
            <Link key={r.id} href={`/runs/${r.id}`} className="notice good" style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <span className="dot mint live" />{r.shortDescription}
            </Link>
          ))}
          {ledger.length === 0 ? <div className="empty">Nothing yet. Registrations, reminders and agent work will show up here as they happen.</div> : (
            <div className="feed">
              {feed.map((f) => (
                <div key={f.key}>
                  <span className={`avatar ${f.kind}`}>{initials(f.name)}</span>
                  <span><span className={`who ${f.kind}`}>{f.name}</span> {f.text}{f.times > 1 && <span className="faint">, {f.times} times</span>}</span>
                  <time>{ago(f.at, now)}</time>
                </div>
              ))}
            </div>
          )}
          <p className="small"><Link href="/activity">Everything that has happened</Link></p>
        </section>}
      </div>
    </>
  );
}
