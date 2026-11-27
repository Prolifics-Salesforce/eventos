import { cookies } from "next/headers";
import { desc } from "drizzle-orm";
import { getDb } from "@/db/client";
import { webhook } from "@/db/schema";
import { erasePersonAction, playbookAction, webhookCreateAction, webhookRemoveAction } from "@/app/actions";
import { requirePrincipal } from "@/lib/session";
import { getProperty } from "@/platform/properties";

export default async function Settings({ searchParams }: { searchParams: Promise<{ notice?: string; ok?: string }> }) {
  const { notice, ok } = await searchParams;
  const me = await requirePrincipal();
  if (!me.permissions.has("admin.manage")) return <><div className="head"><div><h1>Settings</h1></div></div><div className="notice quiet">Only an administrator can see or change these settings.</div></>;
  const db = await getDb();
  const [playbook, hooks] = await Promise.all([getProperty(db, "playbook"), db.select().from(webhook).orderBy(desc(webhook.createdAt))]);
  const secret = ok === "Connected" ? (await cookies()).get("eventos_flash")?.value : undefined;
  return (
    <>
      <div className="head"><div><h1>Settings</h1><p className="muted">How your organisation works, and which other systems are kept informed. Administrators only.</p></div></div>
      {notice && <div className="notice">{notice}</div>}
      {ok && <div className="notice good">{ok}</div>}
      {secret && <div className="notice quiet" style={{ borderColor: "var(--amber)" }}>Signing secret, shown once. Copy it into the receiving system now: <code style={{ color: "var(--ink)", userSelect: "all" }}>{secret}</code></div>}
      <div className="cols">
        <section className="section">
          <h2>Playbook <small>read by every agent before it works</small></h2>
          <form action={playbookAction} className="stack">
            <textarea name="text" rows={14} defaultValue={playbook ?? ""} placeholder={"How we write: plain, warm, no exclamation marks. Sign emails as The Events Team.\nNaming: City + Audience + Format, for example Chennai CXO Dinner.\nNever promise pricing or dates in a follow-up.\nEvery field event needs a registration target and a budget before it goes live."} />
            <div className="actions"><button type="submit">Save playbook</button><span className="small faint">Brand voice, naming rules, compliance and approval policies. Plain language works best.</span></div>
          </form>
        </section>
        <section className="section">
          <h2>Connected systems <small>webhooks</small></h2>
          <p className="small muted" style={{ marginTop: 0 }}>Send registrations, check-ins and leads to a CRM or a data warehouse as they happen. Each delivery is signed and retried if the receiver is down.</p>
          <form action={webhookCreateAction} className="stack" style={{ marginBottom: 18 }}>
            <label>Address to send to<input name="url" type="url" required placeholder="https://hooks.example.com/eventos" /></label>
            <label>Which events, separated by spaces. Use * for everything.<input name="events" defaultValue="registration.created checkin.confirmed lead.captured lead.scored" /></label>
            <div><button type="submit" className="ghost">Connect</button></div>
          </form>
          {hooks.length === 0 ? <div className="empty">Nothing connected yet.</div> : (
            <div className="feed">{hooks.map((h) => (
              <div key={h.id} style={{ alignItems: "center" }}>
                <span><span style={{ fontWeight: 500, wordBreak: "break-all" }}>{h.url}</span><span className="small muted" style={{ display: "block" }}>{h.events.join(", ")}</span></span>
                <form action={webhookRemoveAction} style={{ marginLeft: "auto" }}><input type="hidden" name="webhookId" value={h.id} /><button className="ghost" type="submit">Disconnect</button></form>
              </div>
            ))}</div>
          )}
        </section>
      </div>
      <section className="section" style={{ maxWidth: 560 }}>
        <h2>A person's data <small>privacy requests</small></h2>
        <p className="small muted" style={{ marginTop: 0 }}>When someone asks what you hold about them, or asks to be removed. Find them by the email they registered with.</p>
        <form action="/settings/person" method="post" className="row" style={{ marginBottom: 18 }}>
          <label style={{ flex: 1 }}>Email<input name="email" type="email" required autoComplete="off" /></label>
          <button type="submit" className="ghost">Download their data</button>
        </form>
        <form action={erasePersonAction} className="stack">
          <label>Email<input name="email" type="email" required autoComplete="off" /></label>
          <label className="check"><input type="checkbox" name="confirm" required /> Remove this person, their registrations, leads, survey answers, messages and notes. This cannot be undone.</label>
          <div><button type="submit" className="ghost">Remove this person</button></div>
        </form>
      </section>
    </>
  );
}
