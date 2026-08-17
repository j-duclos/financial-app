import type { TimelineHorizon } from "./timelineCalendarUtils";
import { todayIsoDate } from "./timelineCalendarUtils";

export const SHORT_RANGE_DAYS = 62;
export const DEFAULT_MONTHS_PER_CHUNK = 2;

export const HORIZON_DAY_COUNTS: Record<TimelineHorizon, number> = {
  "14d": 14,
  "3m": 90,
  "6m": 180,
  "12m": 365,
  "24m": 730,
};

export type CalendarChunkWindow = {
  start: string;
  end: string;
};

function parseIso(iso: string): Date {
  return new Date(`${iso}T12:00:00`);
}

export function toIsoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function monthEnd(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0);
}

function addCalendarMonths(d: Date, months: number): Date {
  const year = d.getFullYear();
  const month = d.getMonth() + months;
  const last = new Date(year, month + 1, 0).getDate();
  return new Date(year, month, Math.min(d.getDate(), last));
}

function addDays(d: Date, days: number): Date {
  const next = new Date(d.getTime());
  next.setDate(next.getDate() + days);
  return next;
}

/** Same start/end rules as backend `_timeline_date_range`. */
export function calendarRangeForSelection(
  horizon: TimelineHorizon,
  lookbackMonths: number,
  todayIso: string = todayIsoDate()
): { start: string; end: string } {
  const today = parseIso(todayIso);
  const end = addDays(today, HORIZON_DAY_COUNTS[horizon]);
  const start = new Date(today.getFullYear(), today.getMonth() - lookbackMonths, 1);
  return { start: toIsoDate(start), end: toIsoDate(end) };
}

export function calendarChunkWindows(
  startIso: string,
  endIso: string,
  asOfIso: string,
  monthsPerChunk: number = DEFAULT_MONTHS_PER_CHUNK
): CalendarChunkWindow[] {
  const start = parseIso(startIso);
  const end = parseIso(endIso);
  const asOf = parseIso(asOfIso);
  if (start > end) return [];
  const spanDays = Math.round((end.getTime() - start.getTime()) / 86400000) + 1;
  if (spanDays <= SHORT_RANGE_DAYS) {
    return [{ start: startIso, end: endIso }];
  }
  const step = Math.max(1, monthsPerChunk);
  const firstMonth = new Date(asOf.getFullYear(), asOf.getMonth(), 1);
  const firstEndMonth = addCalendarMonths(firstMonth, step - 1);
  let firstEnd = monthEnd(firstEndMonth);
  if (firstEnd > end) firstEnd = end;
  if (firstEnd < start) {
    const startMonthEnd = monthEnd(start);
    firstEnd = startMonthEnd > end ? end : startMonthEnd;
  }

  const windows: CalendarChunkWindow[] = [{ start: toIsoDate(start), end: toIsoDate(firstEnd) }];
  let cursor = addDays(firstEnd, 1);
  while (cursor <= end) {
    const lastMonth = addCalendarMonths(new Date(cursor.getFullYear(), cursor.getMonth(), 1), step - 1);
    let chunkEnd = monthEnd(lastMonth);
    if (chunkEnd > end) chunkEnd = end;
    windows.push({ start: toIsoDate(cursor), end: toIsoDate(chunkEnd) });
    cursor = addDays(chunkEnd, 1);
  }
  return windows;
}

export function monthKey(year: number, month: number): string {
  return `${year}-${String(month + 1).padStart(2, "0")}`;
}

export function chunkCoversMonth(
  chunk: CalendarChunkWindow,
  year: number,
  month: number
): boolean {
  const monthStart = `${monthKey(year, month)}-01`;
  const last = toIsoDate(monthEnd(new Date(year, month, 1)));
  return chunk.start <= last && chunk.end >= monthStart;
}
