/**
 * Dates as a Dutch café and its customers read them: dd-mm-yyyy.
 *
 * 🚨 WHY WE DO NOT USE `<input type="date">` FOR BIRTHDAYS
 *
 * A native date input renders in the BROWSER's locale, not ours. The same
 * page shows 25-12-1990 to one visitor and 12/25/1990 to another, and there
 * is no attribute, CSS or script that changes it. So "show dd-mm-yyyy
 * everywhere" is not achievable with the native control, and a half-measure
 * would be worse: a field that is dd-mm on most phones and mm-dd on some is
 * how 05-12 silently becomes the wrong month.
 *
 * Display is ours to control, and that is what lives here. Input is handled
 * by components/date-of-birth-input.tsx, which uses three dropdowns so the
 * order is stated rather than inferred.
 *
 * The wire format stays ISO `YYYY-MM-DD` throughout — the API, the database
 * and the birthday sweep all speak it. Only what a human sees is reordered.
 */

/** "1990-12-25" → "25-12-1990". Returns "" for anything unparseable. */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return "";
  return `${m[3]}-${m[2]}-${m[1]}`;
}

/**
 * "1990-12-25" → "25-12". For the customer list, where the year is both
 * noise and the only part that reveals someone's age at a glance.
 */
export function formatDayMonth(iso: string | null | undefined): string {
  if (!iso) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return "";
  return `${m[3]}-${m[2]}`;
}

/**
 * A timestamp as "25-12-1990 14:30".
 *
 * `toLocaleString()` with no arguments renders in the VIEWER's locale, so the
 * same card timeline read 25/12/1990 for one person and 12/25/1990 for
 * another — and for an event log, "was that 5 December or 12 May" is a real
 * question. One format, chosen by us, for everyone.
 *
 * Time is local to the viewer's device, which is correct: a café owner
 * checking when a stamp was given wants their own clock, not UTC.
 */
export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return "";
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  const p = (n: number): string => String(n).padStart(2, "0");
  return `${p(d.getDate())}-${p(d.getMonth() + 1)}-${d.getFullYear()} ${p(
    d.getHours()
  )}:${p(d.getMinutes())}`;
}

/** Build the ISO wire value from three parts, or "" if any is missing. */
export function toIsoDate(day: string, month: string, year: string): string {
  if (!day || !month || !year) return "";
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

/** Split an ISO value back into parts, for editing an existing value. */
export function fromIsoDate(iso: string | null | undefined): {
  day: string;
  month: string;
  year: string;
} {
  const m = iso ? /^(\d{4})-(\d{2})-(\d{2})/.exec(iso) : null;
  if (!m) return { day: "", month: "", year: "" };
  return { day: m[3] ?? "", month: m[2] ?? "", year: m[1] ?? "" };
}

/**
 * Days in a month, so 31 February cannot be chosen.
 *
 * Year matters: without it, 29 February would be offered in every year and a
 * customer born on a leap day could enter a date that does not exist.
 */
export function daysInMonth(month: string, year: string): number {
  const m = Number(month);
  const y = Number(year);
  if (!m) return 31;
  if (!y) return m === 2 ? 29 : [4, 6, 9, 11].includes(m) ? 30 : 31;
  return new Date(y, m, 0).getDate();
}

export const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;
