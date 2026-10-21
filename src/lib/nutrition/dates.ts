/**
 * Timezone-aware local-date helpers. A "day" is the calendar date in the user's
 * IANA timezone at the moment a meal or measurement was logged. That local date
 * is stored alongside the UTC timestamp so history never shifts if the user
 * later changes timezone.
 */

export type LocalDate = string; // YYYY-MM-DD

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export function isLocalDate(s: string): s is LocalDate {
  if (!DATE_RE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** Calendar date of an instant in a timezone. */
export function toLocalDate(instant: Date, timeZone: string): LocalDate {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(instant);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** Offset (minutes) of a timezone from UTC at an instant. */
function tzOffsetMinutes(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return Math.round((asUtc - instant.getTime()) / 60000);
}

/** UTC instant at which a local calendar date starts in a timezone (handles DST). */
export function startOfLocalDay(date: LocalDate, timeZone: string): Date {
  if (!isLocalDate(date)) throw new RangeError(`Invalid date: ${date}`);
  const [y, m, d] = date.split("-").map(Number);
  const guess = Date.UTC(y, m - 1, d, 0, 0, 0);
  let offset = tzOffsetMinutes(new Date(guess), timeZone);
  let instant = guess - offset * 60000;
  // Re-check once in case the offset differs at the actual instant (DST transitions).
  const offset2 = tzOffsetMinutes(new Date(instant), timeZone);
  if (offset2 !== offset) {
    offset = offset2;
    instant = guess - offset * 60000;
  }
  return new Date(instant);
}

/** [start, end) UTC range covering a local date. */
export function localDayRange(date: LocalDate, timeZone: string): { start: Date; end: Date } {
  return { start: startOfLocalDay(date, timeZone), end: startOfLocalDay(addDays(date, 1), timeZone) };
}

export function addDays(date: LocalDate, days: number): LocalDate {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function diffDays(a: LocalDate, b: LocalDate): number {
  return Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86400000);
}

export function dateRange(from: LocalDate, to: LocalDate): LocalDate[] {
  const out: LocalDate[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

export function formatLocalDate(
  date: LocalDate,
  opts: Intl.DateTimeFormatOptions = { weekday: "short", month: "short", day: "numeric" },
): string {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { ...opts, timeZone: "UTC" });
}
