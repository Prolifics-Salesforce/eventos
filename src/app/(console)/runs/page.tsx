import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { event, task } from "@/db/schema";
import { agentsEnabled } from "@/agents/model";
import { ago, initials } from "@/lib/describe";

export default async function Runs({ searchParams }: { searchParams: Promise<{ notice?: string }> }) {
  const { notice } = await searchParams;
  const db = await getDb();
  const rows = await db.select({ t: task, eventName: event.name }).from(task).leftJoin(event, eq(event.id, task.eventId))
    .where(eq(task.taskType, "agent_run")).orderBy(desc(task.createdAt)).limit(100);
  return (
    <>
      <div className="head"><div><h1>Agent runs</h1><p className="muted">Each piece of work an agent has taken on, with every step it took.</p></div></div>
      {notice && <div className="notice">{notice}</div>}
      {!agentsEnabled() && <div className="notice quiet">Agents are switched off. Add ANTHROPIC_API_KEY to the .env file in the project folder and restart to switch them on.</div>}
      {rows.length === 0 ? <div className="empty">No runs yet. Open an event and ask an agent for something.</div> : (
        <div className="rows">{rows.map(({ t, eventName }) => {
          const p = t.payload as { agent: string; goal: string };
          return (
            <Link key={t.id} href={`/runs/${t.id}`} className="rowlink" style={{ gridTemplateColumns: "44px minmax(0,1fr) auto" }}>
              <span className="avatar agent" style={{ width: 36, height: 36 }}>{initials(p.agent)}</span>
              <div><div className="title">{p.goal}</div><div className="small muted">{p.agent}{eventName ? `, ${eventName}` : ""}, {ago(t.createdAt)}</div></div>
              <span className={`pill ${t.state}`}>{t.state === "in_progress" ? "working" : t.state === "open" ? "queued" : t.state}</span>
            </Link>
          );
        })}</div>
      )}
    </>
  );
}
