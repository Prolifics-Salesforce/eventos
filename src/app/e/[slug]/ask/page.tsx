import Link from "next/link";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { event } from "@/db/schema";
import { askConciergeAction } from "@/app/actions";
import { conversation, MAX_QUESTION_LENGTH } from "@/agents/concierge";
import { agentsEnabled } from "@/agents/model";

export const dynamic = "force-dynamic";

export default async function Ask({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ notice?: string }> }) {
  const { slug } = await params;
  const { notice } = await searchParams;
  const db = await getDb();
  const [e] = await db.select().from(event).where(eq(event.slug, slug));
  if (!e || e.status !== "live" || !agentsEnabled()) notFound();
  const chat = (await cookies()).get("eventos_chat")?.value;
  const turns = chat && /^[0-9a-f-]{36}$/.test(chat) ? await conversation(db, chat) : [];
  return (
    <div className="center">
      <div className="card" style={{ maxWidth: 520 }}>
        <div className="small muted"><Link href={`/e/${e.slug}`}>Back to {e.name}</Link></div>
        <h1 style={{ margin: "6px 0 4px" }}>Ask about this event</h1>
        <div className="small muted" style={{ marginBottom: 16 }}>Answered by an AI assistant from the event's public details. It cannot change your registration.</div>
        {turns.map((t, i) => (
          <div key={i} className="note" style={t.who === "guest" ? { borderColor: "var(--accent)" } : undefined}>
            <div className="small muted">{t.who === "guest" ? "You" : "Assistant"}</div>{t.text}
          </div>
        ))}
        {notice && <div className="notice">{notice}</div>}
        <form action={askConciergeAction} className="stack">
          <input type="hidden" name="eventSlug" value={e.slug} />
          <textarea name="question" required maxLength={MAX_QUESTION_LENGTH} placeholder="Where is it, and what time should I arrive?" autoFocus />
          <button type="submit">Ask</button>
        </form>
      </div>
    </div>
  );
}
