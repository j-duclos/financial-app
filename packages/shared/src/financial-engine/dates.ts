/**
 * Deterministic calendar-date helpers (`YYYY-MM-DD`).
 *
 * Arithmetic uses UTC civil dates so the same fixture matches in web, mobile,
 * CI, and any developer timezone. Do not use local `new Date(y, m, d)`.
 */

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export type CalendarDate = {
  year: number;
  month: number;
  day: number;
};

export function isIsoDateString(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  try {
    parseIsoDate(value);
    return true;
  } catch {
    return false;
  }
}

export function parseIsoDate(value: string): CalendarDate {
  const match = ISO_DATE.exec(value.trim());
  if (!match) {
    throw new Error(`Invalid ISO date: ${JSON.stringify(value)}`);
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const utc = Date.UTC(year, month - 1, day);
  const dt = new Date(utc);
  if (dt.getUTCFullYear() !== year || dt.getUTCMonth() !== month - 1 || dt.getUTCDate() !== day) {
    throw new Error(`Invalid calendar date: ${JSON.stringify(value)}`);
  }
  return { year, month, day };
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

export function formatIsoDate(date: CalendarDate): string {
  return `${date.year}-${pad2(date.month)}-${pad2(date.day)}`;
}

/** Compare ISO dates. Negative if a < b. */
export function compareIsoDates(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

export function isIsoDateOnOrBefore(a: string, b: string): boolean {
  return compareIsoDates(a, b) <= 0;
}

export function isIsoDateAfter(a: string, b: string): boolean {
  return compareIsoDates(a, b) > 0;
}

export function addCalendarDays(iso: string, days: number): string {
  const { year, month, day } = parseIsoDate(iso);
  const dt = new Date(Date.UTC(year, month - 1, day + days));
  return formatIsoDate({
    year: dt.getUTCFullYear(),
    month: dt.getUTCMonth() + 1,
    day: dt.getUTCDate(),
  });
}

export function isoDatePart(value: string): string {
  return value.trim().slice(0, 10);
}
