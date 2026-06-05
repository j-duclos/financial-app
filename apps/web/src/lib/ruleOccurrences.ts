import type { RecurringRule, RecurringRuleFrequency } from "@budget-app/shared";
import { formatDateDisplay } from "./dateDisplay";

function parseISO(iso: string): Date {
  return new Date(iso.slice(0, 10) + "T12:00:00");
}

function toISO(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

function isoWeekday(d: Date): number {
  return (d.getDay() + 6) % 7;
}

function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

function nthWeekdayInMonth(year: number, month: number, weekday: number, n: number): Date | null {
  const first = new Date(year, month - 1, 1, 12);
  let delta = (weekday - isoWeekday(first) + 7) % 7;
  if (delta === 0 && isoWeekday(first) !== weekday) delta = 7;
  const firstOcc = addDays(first, delta);
  const occ = addDays(firstOcc, (n - 1) * 7);
  if (occ.getMonth() !== month - 1) return null;
  return occ;
}

/** Mirrors backend generate_rule_occurrences for next-run display. */
export function generateRuleOccurrences(
  rule: RecurringRule,
  rangeStart: string,
  rangeEnd: string
): string[] {
  if (!rule.active) return [];

  const startDate = parseISO(rule.start_date.slice(0, 10));
  const rangeStartD = parseISO(rangeStart);
  const rangeEndD = parseISO(rangeEnd);
  let start = rangeStartD > startDate ? rangeStartD : startDate;
  let end = rangeEndD;

  const ruleEnd = rule.end_date?.slice(0, 10);
  if (ruleEnd && ruleEnd < toISO(end)) end = parseISO(ruleEnd);

  if (rule.paused_at) {
    const pauseCap = addDays(parseISO(rule.paused_at.slice(0, 10)), -1);
    if (start > pauseCap) return [];
    if (end > pauseCap) end = pauseCap;
  }

  if (start > end) return [];

  const interval = Math.max(1, Number(rule.interval) || 1);
  const out: string[] = [];
  const freq = rule.frequency as RecurringRuleFrequency;

  if (freq === "WEEKLY") {
    const dow = rule.day_of_week ?? isoWeekday(startDate);
    let d = new Date(start);
    while (isoWeekday(d) !== dow) d = addDays(d, 1);
    while (d < startDate) d = addDays(d, interval * 7);
    while (d <= end) {
      if (d >= startDate && (!ruleEnd || toISO(d) <= ruleEnd)) out.push(toISO(d));
      d = addDays(d, interval * 7);
    }
  } else if (freq === "BIWEEKLY") {
    const dow = rule.day_of_week ?? isoWeekday(startDate);
    let d = new Date(start);
    while (isoWeekday(d) !== dow) d = addDays(d, 1);
    while (d < startDate) d = addDays(d, interval * 14);
    while (d <= end) {
      if (d >= startDate && (!ruleEnd || toISO(d) <= ruleEnd)) out.push(toISO(d));
      d = addDays(d, interval * 14);
    }
  } else if (freq === "MONTHLY_DAY") {
    const day = Math.max(1, Math.min(31, rule.day_of_month ?? startDate.getDate()));
    let y = start.getFullYear();
    let m = start.getMonth() + 1;
    let monthCount = 0;
    const endY = end.getFullYear();
    const endM = end.getMonth() + 1;
    while (y < endY || (y === endY && m <= endM)) {
      const dim = daysInMonth(y, m);
      const d = new Date(y, m - 1, Math.min(day, dim), 12);
      if (d >= startDate && d >= start && d <= end && (!ruleEnd || toISO(d) <= ruleEnd)) {
        if (monthCount % interval === 0) out.push(toISO(d));
      }
      monthCount += 1;
      m += 1;
      if (m > 12) {
        m = 1;
        y += 1;
      }
    }
  } else if (freq === "MONTHLY_NTH_WEEKDAY") {
    const dow = rule.day_of_week ?? isoWeekday(startDate);
    const nth = Math.max(1, Math.min(5, rule.nth_week ?? 1));
    let y = start.getFullYear();
    let m = start.getMonth() + 1;
    let monthCount = 0;
    const endY = end.getFullYear();
    const endM = end.getMonth() + 1;
    while (y < endY || (y === endY && m <= endM)) {
      const d = nthWeekdayInMonth(y, m, dow, nth);
      if (
        d &&
        d >= startDate &&
        d >= start &&
        d <= end &&
        (!ruleEnd || toISO(d) <= ruleEnd) &&
        monthCount % interval === 0
      ) {
        out.push(toISO(d));
      }
      monthCount += 1;
      m += 1;
      if (m > 12) {
        m = 1;
        y += 1;
      }
    }
  } else if (freq === "YEARLY") {
    const ref = startDate;
    let y = start.getFullYear();
    while (y <= end.getFullYear()) {
      const dim = daysInMonth(y, ref.getMonth() + 1);
      const d = new Date(y, ref.getMonth(), Math.min(ref.getDate(), dim), 12);
      if (d >= start && d <= end && d >= startDate && (!ruleEnd || toISO(d) <= ruleEnd)) {
        if ((y - startDate.getFullYear()) % interval === 0) out.push(toISO(d));
      }
      y += 1;
    }
  }

  return [...new Set(out)].sort();
}

export function getNextRuleRunDate(rule: RecurringRule, todayISO: string): string | null {
  const end = parseISO(todayISO);
  end.setFullYear(end.getFullYear() + 2);
  const occurrences = generateRuleOccurrences(rule, todayISO, toISO(end));
  return occurrences.find((d) => d >= todayISO) ?? null;
}

export function formatNextRunDate(iso: string | null): string {
  if (!iso) return "—";
  return formatDateDisplay(iso);
}
