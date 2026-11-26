import Link from "next/link";
import { asc, ne } from "drizzle-orm";
import { getDb } from "@/db/client";
import { event } from "@/db/schema";
import { insightsFor, money } from "@/lib/insights";
import { requirePrincipal } from "@/lib/session";

export default async function Portfolio() {
  await requirePrincipal();
  const db = await getDb();
  const events = await db.select().from(event).where(ne(event.status, "archived")).orderBy(asc(event.startsAt));
  const figures = await insightsFor(db, events);
  const rows = events.map((e) => ({ e, i: figures.get(e.id)! }));
  const sum = (f: (r: (typeof rows)[number]) => number) => rows.reduce((t, r) => t + f(r), 0);
  const cost = sum((r) => r.i.money.actual ?? r.i.money.planned);
  const pipeline = sum((r) => r.i.money.pipeline);
  const registered = sum((r) => r.i.funnel.registered), attended = sum((r) => r.i.funnel.attended), leads = sum((r) => r.i.leads.total);
  const currency = rows[0]?.i.currency ?? "INR";
  return (
    <>
      <div className="head"><div><h1>Insights</h1><p className="muted">What your events cost and what they produced, across the whole programme.</p></div></div>
      <div className="stats">
        <div className="stat"><b>{rows.length}</b><span>Events</span></div>
        <div className="stat"><b>{attended} <em>of {registered}</em></b><span>Attended, of registered</span></div>
        <div className="stat"><b>{leads}</b><span>Leads, {sum((r) => r.i.leads.hot)} hot</span></div>
        <div className="stat"><b>{money(cost, currency)}</b><span>Cost</span></div>
        <div className="stat"><b>{pipeline ? money(pipeline, currency) : "–"}</b><span>Pipeline</span></div>
        <div className="stat"><b>{cost > 0 && pipeline > 0 ? `${Math.round((pipeline / cost) * 10) / 10}×` : "–"}</b><span>Pipeline for each {currency} spent</span></div>
      </div>
      {rows.length === 0 ? <div className="empty">No events yet.</div> : (
        <table>
          <thead><tr><th>Event</th><th className="num">Registered</th><th className="num">Show rate</th><th className="num">Leads</th><th className="num">Cost</th><th className="num">Per lead</th><th className="num">Pipeline</th><th className="num">Return</th><th className="num">NPS</th></tr></thead>
          <tbody>{rows.map(({ e, i }) => (
            <tr key={e.id}>
              <td><Link href={`/events/${e.id}?tab=insights`}>{e.name}</Link><span className="sub">{e.kind}, {e.status}</span></td>
              <td className="num">{i.funnel.registered}{i.targets.registrations ? <span className="sub">target {i.targets.registrations}</span> : null}</td>
              <td className="num">{i.showRate != null ? `${i.showRate}%` : "–"}</td>
              <td className="num">{i.leads.total}{i.leads.hot ? <span className="sub">{i.leads.hot} hot</span> : null}</td>
              <td className="num">{money(i.money.actual ?? (i.money.planned || null), i.currency)}{i.money.actual == null && i.money.planned ? <span className="sub">planned</span> : null}</td>
              <td className="num">{money(i.money.costPerLead, i.currency)}</td>
              <td className="num">{i.money.pipeline ? money(i.money.pipeline, i.currency) : "–"}</td>
              <td className="num">{i.money.pipelinePerUnitSpent != null ? `${i.money.pipelinePerUnitSpent}×` : "–"}</td>
              <td className="num">{i.nps ? i.nps.score : "–"}</td>
            </tr>
          ))}</tbody>
        </table>
      )}
      <p className="small faint" style={{ marginTop: 18 }}>Cost uses actual figures where they have been entered and planned figures otherwise. Pipeline is what your team recorded against each lead.</p>
    </>
  );
}
