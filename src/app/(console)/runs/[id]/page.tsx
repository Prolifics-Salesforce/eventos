import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { requirePrincipal } from "@/lib/session";
import { sysAudit, sysJournal, task } from "@/db/schema";
import { ago, initials, stepLabel } from "@/lib/describe";

export default async function Run({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  await requirePrincipal();
  const db = await getDb();
  const [run] = await db.select().from(task).where(and(eq(task.id, id), eq(task.taskType, "agent_run")));
  if (!run) notFound();
  const [steps, calls] = await Promise.all([
    db.select().from(sysJournal).where(and(eq(sysJournal.tableName, "task"), eq(sysJournal.recordId, id))).orderBy(asc(sysJournal.id)),
    db.select().from(sysAudit).where(eq(sysAudit.runId, id)),
  ]);
  const payload = run.payload as { agent: string; goal: string; summary?: string; error?: string };
  const working = run.state === "open" || run.state === "in_progress";
  const held = calls.filter((c) => c.status === "held").length;
  return (
    <>
      {working && <meta httpEquiv="refresh" content="3" />}
      <div className="crumb"><Link href="/runs">Agent runs</Link> / {run.number}</div>
      <div className="head">
        <div>
          <h1>{payload.goal}</h1>
          <p className="muted">
            <span className="who agent"><span className="avatar agent">{initials(payload.agent)}</span>{payload.agent}</span>{" "}
            <span className={`pill ${run.state}`}>{working ? "working" : run.state}</span> started {ago(run.createdAt)}
          </p>
        </div>
        {run.eventId && <Link className="button" href={`/events/${run.eventId}`}>Open the event</Link>}
      </div>
      {working && <div className="notice good"><span className="dot mint live" style={{ display: "inline-block", marginRight: 10 }} />Working. This page updates on its own.</div>}
      {payload.error && <div className="notice">{payload.error}</div>}
      {held > 0 && <div className="notice quiet" style={{ borderColor: "var(--amber)", color: "var(--amber)" }}>{held} {held === 1 ? "action is" : "actions are"} waiting for your decision in the <Link href="/inbox">Inbox</Link>.</div>}
      <section className="section" style={{ maxWidth: 720 }}>
          <h2>What it did <small>{calls.length} {calls.length === 1 ? "action" : "actions"}</small></h2>
          {steps.length === 0 ? <div className="empty">{working ? "Starting…" : "Nothing was recorded."}</div> : (
            <div className="trail">{steps.map((s) => {
              const act = s.kind === "system";
              const tone = !act ? "" : s.body.includes("held for approval") ? "held" : /denied|failed|rejected|may not use|stopped/.test(s.body) ? "bad" : "";
              return <div key={s.id} className={`step ${act ? "act" : ""} ${tone}`}>{act ? stepLabel(s.body) : s.body}</div>;
            })}</div>
          )}
      </section>
    </>
  );
}
