import { and, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { can, requirePrincipal } from "@/lib/session";
import { Denied } from "@/components/denied";

import { sysPolicy, sysUser } from "@/db/schema";
import { setPolicyAction } from "@/app/actions";
import { AGENTS, CONCIERGE, type AgentName } from "@/agents/definitions";
import { initials } from "@/lib/describe";
import { loadPrincipal } from "@/platform/principal";
import { getTool } from "@/platform/tools";
import "@/tools";

const ROLE: Record<string, string> = {
  Builder: "Plans events from the brief and sets them up.",
  "Lead Intelligence": "Scores every captured lead and drafts the follow-up.",
  Analyst: "Tells you how each live event is going, once a day.",
  Outreach: "Writes to guests: reminders, updates, invitations.",
  Concierge: "Answers guests' questions on the public event page.",
};
const PLAIN: Record<string, string> = {
  "event.get": "Read events", "event.public_info": "Read public event details", "session.create": "Add sessions", "task.create": "Add to-dos", "note.add": "Write notes",
  "event.set_status": "Take events live or close them", "lead.get": "Read leads", "lead.score": "Score leads", "message.send": "Send a message to one contact", "campaign.send": "Message a group of guests",
};

export default async function Agents({ searchParams }: { searchParams: Promise<{ notice?: string; ok?: string }> }) {
  const { notice, ok } = await searchParams;
  if (!can(await requirePrincipal(), "admin.manage")) return <Denied title="Agents" />;
  const db = await getDb();
  const agents = await db.select().from(sysUser).where(and(eq(sysUser.kind, "agent"), eq(sysUser.active, true)));
  const policies = await db.select().from(sysPolicy);
  return (
    <>
      <div className="head"><div><h1>Agents</h1><p className="muted">Decide how far each agent may go on its own. Work that stays inside the team is always automatic; anything guests or the public would see asks first unless you say otherwise.</p></div></div>
      {notice && <div className="notice">{notice}</div>}
      {ok && <div className="notice good">{ok}</div>}
      {await Promise.all(agents.map(async (a) => {
        const principal = await loadPrincipal(db, a.id);
        const list = a.name === "Concierge" ? CONCIERGE.tools : AGENTS[a.name as AgentName]?.tools ?? [];
        const names = list.filter((n) => { const t = getTool(n); return t && principal?.permissions.has(t.permission); });
        const outward = names.filter((n) => ["external", "destructive"].includes(getTool(n)!.risk));
        const inward = names.filter((n) => !outward.includes(n));
        return (
          <section className="section" key={a.id}>
            <h2><span className="who agent"><span className="avatar agent">{initials(a.name)}</span>{a.name}</span> <small>{ROLE[a.name]}</small></h2>
            <p className="small muted" style={{ margin: "0 0 10px" }}>On its own: {inward.map((n) => PLAIN[n] ?? n).join(", ").toLowerCase() || "nothing"}.</p>
            {outward.length > 0 && (
              <div className="rows">{outward.map((n) => {
                const policy = policies.find((p) => p.userId === a.id && p.tool === n);
                const auto = policy?.level === "auto";
                return (
                  <form action={setPolicyAction} className="rowitem" key={n} style={{ gridTemplateColumns: "minmax(0,1fr) auto" }}>
                    <input type="hidden" name="agentId" value={a.id} /><input type="hidden" name="tool" value={n} />
                    <div><div style={{ fontWeight: 600 }}>{PLAIN[n] ?? n}</div><div className="small muted">{auto ? `Does this without asking${policy?.dailyCap ? `, up to ${policy.dailyCap} a day; beyond that it asks` : ""}.` : "Asks you first, every time."}</div></div>
                    <div className="actions">
                      <input name="dailyCap" type="number" min={1} placeholder="Daily limit" defaultValue={policy?.dailyCap ?? ""} style={{ width: 120 }} aria-label="Daily limit when automatic" />
                      <button type="submit" name="level" value="approve" className={auto ? "ghost" : "amber"}>Ask first</button>
                      <button type="submit" name="level" value="auto" className={auto ? "mint" : "ghost"}>Automatic</button>
                    </div>
                  </form>
                );
              })}</div>
            )}
          </section>
        );
      }))}
    </>
  );
}
