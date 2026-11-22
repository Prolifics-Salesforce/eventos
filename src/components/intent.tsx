/**
 * Shows an agent's held request as what will actually happen: the email as the
 * recipient will read it, the change as before and after. The raw request is
 * one click away for anyone who wants it.
 */
import Link from "next/link";
import { and, count, eq, inArray, isNotNull } from "drizzle-orm";
import type { Db } from "@/db/client";
import { contact, event, registration, task } from "@/db/schema";
import { decideAction } from "@/app/actions";
import { ago, initials, segmentLabel } from "@/lib/describe";

type Approval = typeof task.$inferSelect;
type Payload = { tool: string; input: Record<string, string>; runId?: string | null };

/** The agent's draft, open for rewording. What is in these fields when Approve is pressed is what gets sent. */
function Draft({ to, input }: { to?: string | null; input: Record<string, string> }) {
  return (
    <div className="paper draft">
      {to && <span className="to">{to}</span>}
      {input.channel !== "whatsapp" && <input name="subject" defaultValue={input.subject ?? ""} aria-label="Subject" className="subject" />}
      <textarea name="body" defaultValue={input.body} aria-label="Message" rows={Math.min(14, Math.max(4, (input.body ?? "").split("\n").length + 1))} />
    </div>
  );
}

async function preview(db: Db, { tool, input }: Payload, editable: boolean): Promise<{ title: string; body: React.ReactNode; consequence?: string; verb: string }> {
  const eventName = async () => (input.eventId ? (await db.select({ name: event.name, status: event.status }).from(event).where(eq(event.id, input.eventId)))[0] : undefined);
  if (tool === "message.send") {
    const [to] = await db.select().from(contact).where(eq(contact.id, input.contactId));
    const via = input.channel === "whatsapp" ? "WhatsApp message" : "Email";
    return {
      title: `${via} to ${to ? `${to.firstName} ${to.lastName ?? ""}`.trim() : "a contact"}`, verb: "Approve and send",
      body: editable ? <Draft to={`To ${input.channel === "whatsapp" ? to?.phone : to?.email}`} input={input} />
        : <div className="paper"><span className="to">To {input.channel === "whatsapp" ? to?.phone : to?.email}</span>{input.subject && <span className="subject">{input.subject}</span>}{input.body}</div>,
      consequence: "One person will receive this. You can reword it before approving.",
    };
  }
  if (tool === "campaign.send") {
    const e = await eventName();
    const filter = { all: inArray(registration.status, ["registered", "attended"]), not_checked_in: eq(registration.status, "registered"), checked_in: isNotNull(registration.checkedInAt), invited: eq(registration.status, "invited") }[input.segment];
    const [n] = await db.select({ n: count() }).from(registration).where(and(eq(registration.eventId, input.eventId), filter));
    return {
      title: `${input.channel === "whatsapp" ? "WhatsApp message" : "Email"} to ${segmentLabel(input.segment)}`, verb: "Approve and send",
      body: editable ? <Draft to={e?.name} input={input} />
        : <div className="paper"><span className="to">{e?.name}</span>{input.subject && <span className="subject">{input.subject}</span>}{input.body}</div>,
      consequence: `Up to ${n.n} ${n.n === 1 ? "person" : "people"} will receive this. Anyone without consent for the channel is skipped. You can reword it before approving.`,
    };
  }
  if (tool === "event.set_status") {
    const e = await eventName();
    const effect: Record<string, string> = { live: "The public page will open for registration.", closed: "Registration will stop. Guests keep their passes.", archived: "The event will disappear from the public site.", draft: "The public page will be taken down." };
    return {
      title: `Change ${e?.name ?? "an event"}`, verb: "Approve",
      body: <div className="change"><span className={`pill ${e?.status}`}>{e?.status}</span><span className="faint">becomes</span><span className={`pill ${input.status}`}>{input.status}</span></div>,
      consequence: effect[input.status],
    };
  }
  return { title: `Run ${tool}`, verb: "Approve and run", body: <div className="paper">{JSON.stringify(input, null, 2)}</div> };
}

export async function Intent({ db, approval, agent, compact = false }: { db: Db; approval: Approval; agent: string; compact?: boolean }) {
  const payload = approval.payload as Payload;
  const p = await preview(db, payload, !compact);
  const [run] = payload.runId ? await db.select().from(task).where(eq(task.id, payload.runId)) : [];
  const goal = (run?.payload as { goal?: string } | undefined)?.goal;
  return (
    <article className="intent">
      <header>
        <span className="who agent"><span className="avatar agent">{initials(agent)}</span>{agent} wants to</span>
        <span className="faint small">{approval.number} · {ago(approval.createdAt)}</span>
      </header>
      <h3>{p.title}</h3>
      <p className="why">
        {goal ? <>Because you asked: “{goal}” </> : null}
        {run && <Link href={`/runs/${run.id}`}>See its reasoning</Link>}
      </p>
      <form action={decideAction}>
        <input type="hidden" name="taskId" value={approval.id} />
        {!compact && p.body}
        {p.consequence && <p className="small muted" style={{ margin: "0 0 14px" }}>{compact ? p.consequence.replace(" You can reword it before approving.", "") : p.consequence}</p>}
        <div className="actions">
          <button type="submit" name="decision" value="approve" className="amber">{p.verb}</button>
          <button type="submit" name="decision" value="reject" className="ghost" formNoValidate>Reject</button>
          {compact && <><input type="hidden" name="returnTo" value="/today" /><Link className="small" href="/inbox">Read or reword it</Link></>}
        </div>
      </form>
      {!compact && <details><summary>Technical details</summary><pre>{JSON.stringify(payload, null, 2)}</pre></details>}
    </article>
  );
}
