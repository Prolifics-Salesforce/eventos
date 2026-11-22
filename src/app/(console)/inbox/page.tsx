import { and, desc, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { sysUser, task } from "@/db/schema";
import { Intent } from "@/components/intent";

export default async function Inbox({ searchParams }: { searchParams: Promise<{ notice?: string }> }) {
  const { notice } = await searchParams;
  const db = await getDb();
  const rows = await db.select({ t: task, by: sysUser.name }).from(task).leftJoin(sysUser, eq(sysUser.id, task.createdBy))
    .where(and(eq(task.taskType, "approval"), eq(task.state, "awaiting_approval"))).orderBy(desc(task.createdAt));
  return (
    <>
      <div className="head"><div><h1>Inbox</h1><p className="muted">What your agents want to do next. Each is shown as it will happen; nothing goes out until you approve it.</p></div></div>
      {notice && <div className="notice">{notice}</div>}
      <div style={{ maxWidth: 720 }}>
        {rows.length === 0
          ? <div className="notice quiet">Nothing is waiting. To let an agent act without asking, change its setting under Agents.</div>
          : rows.map(({ t, by }) => <Intent key={t.id} db={db} approval={t} agent={by ?? "An agent"} />)}
      </div>
    </>
  );
}
