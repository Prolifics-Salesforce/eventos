/** What a new event starts with, and what instance-wide screens (Today, Activity) show times in. Set per deployment. */
export const DEFAULT_TIMEZONE = process.env.APP_TIMEZONE ?? "Asia/Kolkata";
export const DEFAULT_CURRENCY = (process.env.APP_CURRENCY ?? "INR").toUpperCase();

/** True for a zone name this server can keep time in, e.g. "Europe/London". */
export function isTimeZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/** True for a three-letter currency code this server can format, e.g. "USD". */
export function isCurrency(code: string): boolean {
  if (!/^[A-Z]{3}$/.test(code)) return false;
  try {
    new Intl.NumberFormat("en", { style: "currency", currency: code });
    return true;
  } catch {
    return false;
  }
}

/**
 * Every zone name the server knows, for a picker. The server lists some zones under an older name
 * (Asia/Calcutta for Asia/Kolkata), so the value already in use is always added: a picker that lacks
 * the current value would show, and then save, a different one.
 */
export function timeZones(current: string = DEFAULT_TIMEZONE): string[] {
  const zones = Intl.supportedValuesOf("timeZone");
  return zones.includes(current) ? zones : [...zones, current].sort();
}

/** A datetime-local value ("2027-02-12T09:00") read as wall-clock time in a zone, as an ISO instant. */
export function zonedToIso(local: string, timeZone: string): string {
  const asUtc = new Date(`${local}:00Z`);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(asUtc);
  const get = (type: string) => Number(parts.find((p) => p.type === type)!.value);
  const shown = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return new Date(asUtc.getTime() - (shown - asUtc.getTime())).toISOString();
}

export function formatWhen(date: Date | null, timeZone: string): string {
  if (!date) return "Date to be set";
  return new Intl.DateTimeFormat("en-IN", { timeZone, dateStyle: "medium", timeStyle: "short" }).format(date);
}
