import type { ReactNode } from "react";
import Link from "next/link";
import { and, count, desc, eq, inArray } from "drizzle-orm";
import { getDb } from "@/db/client";
import { event, task } from "@/db/schema";
import { signOutAction } from "@/app/actions";
import { agentsEnabled } from "@/agents/model";
import { CommandBar, type Command } from "@/components/command-bar";
import { RailNav } from "@/components/rail-nav";
import { ThemeToggle } from "@/components/theme-toggle";
import { initials } from "@/lib/describe";
import { can, requirePrincipal } from "@/lib/session";
import type { Permission } from "@/platform/permissions";

export const dynamic = "force-dynamic";

/** Each screen and the permission a person needs to be shown it. The screen itself checks again. */
const SCREENS: { href: string; label: string; icon: string; needs: Permission }[] = [
  { href: "/today", label: "Today", icon: "today", needs: "event.read" }, { href: "/events", label: "Events", icon: "events", needs: "event.read" }, { href: "/inbox", label: "Inbox", icon: "inbox", needs: "approval.decide" },
  { href: "/insights", label: "Insights", icon: "insights", needs: "insights.read" }, { href: "/runs", label: "Agent runs", icon: "runs", needs: "agent.run" }, { href: "/agents", label: "Agents", icon: "agents", needs: "admin.manage" },
  { href: "/team", label: "Team", icon: "team", needs: "admin.manage" }, { href: "/activity", label: "Activity", icon: "activity", needs: "audit.read" }, { href: "/settings", label: "Settings", icon: "settings", needs: "admin.manage" },
];

export default async function ConsoleLayout({ children }: { children: ReactNode }) {
  const principal = await requirePrincipal();
  const NAV = SCREENS.filter((s) => can(principal, s.needs));
  const db = await getDb();
  const [[waiting], [working], events] = await Promise.all([
    db.select({ n: count() }).from(task).where(and(eq(task.taskType, "approval"), eq(task.state, "awaiting_approval"))),
    db.select({ n: count() }).from(task).where(and(eq(task.taskType, "agent_run"), inArray(task.state, ["open", "in_progress"]))),
    db.select({ id: event.id, name: event.name, status: event.status }).from(event).orderBy(desc(event.createdAt)).limit(40),
  ]);
  const commands: Command[] = [
    ...events.flatMap((e) => [
      { label: e.name, href: `/events/${e.id}`, hint: `Event · ${e.status}` },
      ...(can(principal, "contact.read") ? [{ label: `${e.name}: guests`, href: `/events/${e.id}?tab=guests`, hint: "Guest list" }] : []),
      ...(can(principal, "checkin.write") ? [{ label: `${e.name}: door desk`, href: `/events/${e.id}/desk`, hint: "Check-in" }] : []),
    ]),
    ...NAV.map((n) => ({ label: n.label, href: n.href, hint: "Screen" })),
    { label: "My account", href: "/account", hint: "Screen" },
  ];
  const on = agentsEnabled();
  return (
    <div className="shell">
      <nav className="rail" aria-label="Main">
        <Link href="/today" className="brand">Event<i>OS</i></Link>
        <RailNav items={NAV.map((n) => ({ href: n.href, label: n.label, icon: n.icon, count: n.href === "/inbox" ? waiting.n : 0 }))} />
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
          <div className="me">
            <ThemeToggle />
            <Link href="/account" className="chip" title="Your account"><span className="avatar">{initials(principal.name)}</span><span>{principal.name.split(" ")[0]}</span></Link>
          </div>
        </div>
        <main className="page">{children}</main>
      </div>
    </div>
  );
}
