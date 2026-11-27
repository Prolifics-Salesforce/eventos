import { eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { event } from "@/db/schema";
import { appUrl } from "@/platform/properties";

export const dynamic = "force-dynamic";

const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
/** Escape text for a calendar file, and fold long lines as the format asks. */
const line = (name: string, value: string) => {
  const text = `${name}:${value.replace(/\\/g, "\\\\").replace(/\r?\n/g, "\\n").replace(/([,;])/g, "\\$1")}`;
  return text.match(/.{1,73}/gu)!.join("\r\n ");
};

/** The event as a calendar file that Google Calendar, Outlook and Apple Calendar all open. Public for a public event. */
export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const [e] = await (await getDb()).select().from(event).where(eq(event.slug, (await params).slug));
  if (!e || !e.startsAt || e.status === "draft" || e.status === "archived") return new Response("No such event.", { status: 404 });
  const end = e.endsAt ?? new Date(e.startsAt.getTime() + 3600_000);
  const url = `${appUrl()}/e/${e.slug}`;
  const body = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//EventOS//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${e.id}@eventos`, `DTSTAMP:${stamp(new Date())}`, `DTSTART:${stamp(e.startsAt)}`, `DTEND:${stamp(end)}`,
    line("SUMMARY", e.name),
    ...(e.venue ? [line("LOCATION", e.venue)] : []),
    line("DESCRIPTION", [e.description, url].filter(Boolean).join("\n\n").slice(0, 3000)),
    `URL:${url}`,
    `STATUS:${e.status === "cancelled" ? "CANCELLED" : "CONFIRMED"}`,
    `SEQUENCE:${Math.floor(e.updatedAt.getTime() / 1000)}`,
    "END:VEVENT", "END:VCALENDAR",
  ].join("\r\n");
  return new Response(body, { headers: { "content-type": "text/calendar; charset=utf-8", "content-disposition": `attachment; filename="${e.slug}.ics"`, "cache-control": "no-store" } });
}
