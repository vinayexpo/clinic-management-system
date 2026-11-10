/**
 * The clinic runs on India Standard Time. Every date the app shows, filters by, or sends to the
 * API must be computed in IST. Never use Date#toISOString() for a clinic date: it returns UTC,
 * which is the previous day for early-morning IST.
 */
export const CLINIC_TZ = "Asia/Kolkata";

/** Calendar date "YYYY-MM-DD" in IST for the given instant (default: now). */
export function istDate(d: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: CLINIC_TZ, year: "numeric", month: "2-digit", day: "2-digit" })
    .formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** First day of the IST month containing `d`, as "YYYY-MM-DD". */
export function istMonthStart(d: Date = new Date()): string {
  return `${istDate(d).slice(0, 7)}-01`;
}

/** Human date for headings, e.g. "Wednesday, 14 Oct 2026", in IST. */
export function istLongDate(d: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-IN", { timeZone: CLINIC_TZ, weekday: "long", day: "2-digit", month: "short", year: "numeric" }).format(d);
}

/** Compact, human-readable clinic date for narrow headers. */
export function istCompactDate(d: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-IN", { timeZone: CLINIC_TZ, weekday: "short", day: "numeric", month: "short" }).format(d);
}

/** Date only, e.g. "16 Oct 2026", for dense table cells. */
export function istShortDate(value: string | null | undefined): string {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value).slice(0, 10);
  return new Intl.DateTimeFormat("en-IN", { timeZone: CLINIC_TZ, day: "2-digit", month: "short", year: "numeric" }).format(parsed);
}

/** Formatted clinic time, e.g. "10:30 AM". */
export function istTime(d: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-IN", { timeZone: CLINIC_TZ, hour: "numeric", minute: "2-digit", hour12: true }).format(d);
}

/** 24-hour clinic time "HH:mm" in IST for the given instant (default: now). */
export function istTime24(d: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: CLINIC_TZ,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(d);
}

/** Returns the next clean slot time (e.g. at 16:35 -> next 15-min mark like 16:45), or current time if already on mark. */
export function istNextSlotTime(intervalMinutes = 15, d: Date = new Date()): string {
  const current = istTime24(d);
  const [hStr, mStr] = current.split(":");
  let h = parseInt(hStr, 10);
  let m = parseInt(mStr, 10);
  const rem = m % intervalMinutes;
  if (rem > 0) {
    m += intervalMinutes - rem;
    if (m >= 60) {
      h += Math.floor(m / 60);
      m = m % 60;
    }
  }
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(h)}:${pad(m)}`;
}

/** Short date and time, e.g. "14 Oct 2026, 2:05 pm", in IST. */
export function istDateTime(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return new Intl.DateTimeFormat("en-IN", { timeZone: CLINIC_TZ, day: "2-digit", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", hour12: true }).format(d);
}

/**
 * Date-only value from an API timestamp or date string, as shown to users.
 * Dates from Laravel are already IST calendar dates ("2026-10-14" or "2026-10-14T00:00:00.000000Z");
 * taking the first 10 characters keeps the clinic's calendar date.
 */
export function apiDate(value: string | null | undefined): string {
  return value ? String(value).slice(0, 10) : "—";
}
