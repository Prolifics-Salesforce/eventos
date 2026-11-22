import type { ReactNode } from "react";
import Link from "next/link";
import { and, count, desc, eq, inArray } from "drizzle-orm";
import { getDb } from "@/db/client";
import { event, task } from "@/db/schema";
import { signOutAction } from "@/app/actions";
import { agentsEnabled } from "@/agents/model";
import { CommandBar, type Command } from "@/components/command-bar";
import { Icon } from "@/components/icons";
import { requirePrincipal } from "@/lib/session";

export const dynamic = "force-dynamic";

const NAV = [
  { href: "/today", label: "Today", icon: "today" }, { href: "/events", label: "Events", icon: "events" }, { href: "/inbox", label: "Inbox", icon: "inbox" },
  { href: "/insights", label: "Insights", icon: "insights" }, { href: "/runs", label: "Agent runs", icon: "runs" }, { href: "/agents", label: "Agents", icon: "agents" }, { href: "/team", label: "Team", icon: "team" }, { href: "/activity", label: "Activity", icon: "activity" }, { href: "/settings", label: "Settings", icon: "settings" },
];

export default async function ConsoleLayout({ children }: { children: ReactNode }) {
  const principal = await requirePrincipal();
  const db = await getDb();
  const [[waiting], [working], events] = await Promise.all([
    db.select({ n: count() }).from(task).where(and(eq(task.taskType, "approval"), eq(task.state, "awaiting_approval"))),
    db.select({ n: count() }).from(task).where(and(eq(task.taskType, "agent_run"), inArray(task.state, ["open", "in_progress"]))),
    db.select({ id: event.id, name: event.name, status: event.status }).from(event).orderBy(desc(event.createdAt)).limit(40),
  ]);
  const commands: Command[] = [
    ...events.flatMap((e) => [
      { label: e.name, href: `/events/${e.id}`, hint: `Event · ${e.status}` },
      { label: `${e.name}: guests`, href: `/events/${e.id}?tab=guests`, hint: "Guest list" },
      { label: `${e.name}: door desk`, href: `/events/${e.id}/desk`, hint: "Check-in" },
    ]),
    ...NAV.map((n) => ({ label: n.label, href: n.href, hint: "Screen" })),
    { label: "My account", href: "/account", hint: "Screen" },
  ];
  const on = agentsEnabled();
  return (
    <div className="shell">
      <nav className="rail" aria-label="Main">
        <Link href="/today" className="brand">Event<i>OS</i></Link>
        {NAV.map((n) => (
          <Link key={n.href} href={n.href} className="nav">
            <Icon name={n.icon} /><span className="label">{n.label}</span>
            {n.href === "/inbox" && waiting.n > 0 && <span className="count">{waiting.n}</span>}
          </Link>
        ))}
        <div className="foot small">
          <Link href="/account">{principal.name}</Link>
          <form action={signOutAction}><button className="link" type="submit">Sign out</button></form>
        </div>
      </nav>
      <div className="main">
        <div className="topbar">
          <CommandBar commands={commands} />
          <span className="status wide">
            <span className={`dot ${on ? "mint" : ""} ${working.n > 0 ? "live" : ""}`} />
            {!on ? "Agents are off" : working.n > 0 ? `${working.n} agent ${working.n === 1 ? "run" : "runs"} in progress` : "Agents are idle"}
          </span>
        </div>
        <main className="page">{children}</main>
      </div>
    </div>
  );
}
