import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { event, formField } from "@/db/schema";
import { and } from "drizzle-orm";
import { FieldInputs } from "@/components/field-inputs";
import { captureLeadAction } from "@/app/actions";

export default async function Capture({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ notice?: string; ok?: string }> }) {
  const { id } = await params;
  const { notice, ok } = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const db = await getDb();
  const [e] = await db.select().from(event).where(eq(event.id, id));
  if (!e) notFound();
  const fields = await db.select().from(formField).where(and(eq(formField.eventId, id), eq(formField.purpose, "lead")));
  return (
    <>
      <div className="small muted"><Link href={`/events/${id}?tab=leads`}>Back to {e.name}</Link></div>
      <h1 style={{ margin: "6px 0 14px" }}>Capture a lead</h1>
      {notice && <div className="notice">{notice}</div>}
      {ok && <div className="notice good">{ok}. Ready for the next one.</div>}
      <form action={captureLeadAction} className="stack" key={ok ?? "form"}>
        <input type="hidden" name="eventId" value={id} /><input type="hidden" name="returnTo" value={`/events/${id}/capture`} />
        <label>First name<input name="firstName" required autoFocus autoComplete="off" /></label>
        <label>Last name<input name="lastName" autoComplete="off" /></label>
        <label>Email<input name="email" type="email" required autoComplete="off" inputMode="email" /></label>
        <FieldInputs fields={fields} />
        <label>What did you talk about?<textarea name="notes" placeholder="What they need, when, and what you promised" /></label>
        <button type="submit">Save lead</button>
      </form>
    </>
  );
}
