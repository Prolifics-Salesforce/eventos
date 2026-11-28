import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { contact, event, registration } from "@/db/schema";

export const dynamic = "force-dynamic";
export const metadata = { title: "Certificate of attendance", robots: { index: false, follow: false } };

/** A certificate for a guest who was checked in, laid out to print on one landscape page. */
export default async function Certificate({ params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const [row] = await (await getDb()).select({ r: registration, c: contact, e: event }).from(registration)
    .innerJoin(contact, eq(contact.id, registration.contactId)).innerJoin(event, eq(event.id, registration.eventId))
    .where(and(eq(registration.id, id), eq(event.slug, slug)));
  // Only someone who was actually checked in has attended.
  if (!row || !row.r.checkedInAt) notFound();
  const { r, c, e } = row;
  const day = new Intl.DateTimeFormat("en-IN", { timeZone: e.timezone, day: "numeric", month: "long", year: "numeric" }).format(e.startsAt ?? r.checkedInAt!);
  return (
    <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24, background: "#efedf7" }}>
      <style>{`@media print { .noprint { display: none !important; } body::before { display: none; } @page { size: landscape; margin: 12mm; } }`}</style>
      <div>
        <div className="noprint actions" style={{ justifyContent: "center", marginBottom: 16, color: "#17123a" }}>
          <span className="small">Use your browser's Print to save or print this.</span>
        </div>
        <div style={{ width: "min(880px, 94vw)", aspectRatio: "1.414 / 1", background: "#fff", color: "#17123a", borderRadius: 10, padding: "clamp(24px, 6vw, 64px)", display: "grid", alignContent: "center", textAlign: "center", border: "10px solid #17123a", outline: "2px solid #c9c3f0", outlineOffset: -18 }}>
          <div style={{ letterSpacing: "0.22em", textTransform: "uppercase", fontSize: 13, color: "#6a55f0", fontWeight: 700 }}>Certificate of attendance</div>
          <div style={{ margin: "26px 0 6px", fontSize: 15 }}>This is to certify that</div>
          <div style={{ font: "700 clamp(30px, 6vw, 54px)/1.1 var(--display)", letterSpacing: "-0.03em" }}>{c.firstName} {c.lastName}</div>
          <div style={{ margin: "18px 0 6px", fontSize: 15 }}>attended</div>
          <div style={{ font: "650 clamp(20px, 3.4vw, 30px)/1.2 var(--display)" }}>{e.name}</div>
          <div style={{ marginTop: 14, fontSize: 15, color: "#4b4580" }}>{day}{e.venue ? ` · ${e.venue}` : ""}</div>
          <div style={{ marginTop: 34, display: "flex", justifyContent: "space-between", gap: 20, fontSize: 13, color: "#4b4580", textAlign: "left" }}>
            <div>{e.hostName ? <><div style={{ color: "#17123a", fontWeight: 600 }}>{e.hostName}</div>Host</> : null}</div>
            <div style={{ textAlign: "right" }}><div style={{ color: "#17123a", fontWeight: 600 }}>{r.number}</div>Registration</div>
          </div>
        </div>
      </div>
    </div>
  );
}
