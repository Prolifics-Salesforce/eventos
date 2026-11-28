import type { CSSProperties } from "react";

/** A number from 0 to 359 that is always the same for the same event, so each event keeps its own colour. */
export function hueOf(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return h % 360;
}

/** Sets an event's colour on an element, for everything inside it. Add className "hue" to tint the whole page. */
export const hueStyle = (id: string): CSSProperties => ({ ["--hue" as string]: hueOf(id) });

type PosterEvent = { id: string; name: string; startsAt: Date | null; timezone: string; coverImageUrl: string | null };

/**
 * The picture an event is known by. The organiser's cover image when there is
 * one; otherwise a poster drawn from the event's own colour and date, so no
 * event ever shows a blank box.
 */
export function Poster({ event: e, size, children }: { event: PosterEvent; size?: "mini" | "wide"; children?: React.ReactNode }) {
  const part = (opts: Intl.DateTimeFormatOptions) => (e.startsAt ? new Intl.DateTimeFormat("en-IN", { timeZone: e.timezone, ...opts }).format(e.startsAt) : "");
  return (
    <div className={`poster ${size ?? ""}`} style={hueStyle(e.id)}>
      {e.coverImageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={e.coverImageUrl} alt="" />
      ) : (
        <div>
          {e.startsAt ? <><div className="mon">{part({ month: "short" })}</div><div className="day">{part({ day: "numeric" })}</div></> : <div className="mon">Date to come</div>}
          {!size && <div className="nm">{e.name}</div>}
        </div>
      )}
      {children}
    </div>
  );
}
