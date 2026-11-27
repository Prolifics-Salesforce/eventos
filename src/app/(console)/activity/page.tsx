import { desc, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { can, requirePrincipal } from "@/lib/session";
import { Denied } from "@/components/denied";

import { sysAudit, sysOutbox, sysUser } from "@/db/schema";
import { initials, sentence } from "@/lib/describe";
import { DEFAULT_TIMEZONE } from "@/lib/when";

const fmt = (d: Date) => new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: DEFAULT_TIMEZONE }).format(d);

export default async function Activity() {
  if (!can(await requirePrincipal(), "audit.read")) return <Denied title="Activity" />;
  const db = await getDb();
  const [calls, messages] = await Promise.all([
    db.select({ a: sysAudit, actor: sysUser.name }).from(sysAudit).leftJoin(sysUser, eq(sysUser.id, sysAudit.actorId)).orderBy(desc(sysAudit.id)).limit(120),
    db.select().from(sysOutbox).orderBy(desc(sysOutbox.createdAt)).limit(20),
  ]);
  return (
    <>
      <div className="head"><div><h1>Activity</h1><p className="muted">Everything done in this instance, by people, by agents and by automatic rules. Nothing here can be edited.</p></div></div>
      <div className="cols">
        <section className="section">
          <h2>Ledger <small>latest {calls.length}</small></h2>
          {calls.length === 0 ? <div className="empty">Nothing has happened yet.</div> : (
            <div className="feed">{calls.map(({ a, actor }) => (
              <div key={a.id}>
                <span className={`avatar ${a.actorKind}`}>{initials(actor ?? "?")}</span>
                <span>
                  <span className={`who ${a.actorKind}`}>{actor ?? "Unknown"}</span> {sentence(a.tool, a.input, a.status)}
                  {a.status !== "ok" && <> <span className={`pill ${a.status}`}>{a.status === "held" ? "waiting for approval" : a.status}</span></>}
                  {a.error && a.status !== "held" && <span className="small muted" style={{ display: "block" }}>{a.error.slice(0, 160)}</span>}
                </span>
                <time>{fmt(a.at)}</time>
              </div>
            ))}</div>
          )}
        </section>
        <section className="section">
          <h2>Messages <small>latest {messages.length}</small></h2>
          {messages.length === 0 ? <div className="empty">No messages yet.</div> : (
            <div className="feed">{messages.map((m) => (
              <div key={m.id}><span><span style={{ fontWeight: 500 }}>{m.subject ?? "WhatsApp message"}</span><span className="small muted" style={{ display: "block" }}>{m.recipient}, {fmt(m.createdAt)}</span></span><span className={`pill ${m.status}`} style={{ marginLeft: "auto" }}>{m.status}</span></div>
            ))}</div>
          )}
        </section>
      </div>
    </>
  );
}
