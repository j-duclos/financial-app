import type { OperationalForecastDays } from "@budget-app/shared";
import type { TimelineCalendarDay, TimelineCalendarTransaction } from "@budget-app/shared";
import { addDaysToIsoDate, todayStr } from "@/lib/dates";

export function parseCalendarAmount(val: string | null | undefined): number {
  if (val == null || val === "") return 0;
  const n = parseFloat(val);
  return Number.isFinite(n) ? n : 0;
}

export function calendarRangeForSelection(
  forecastDays: OperationalForecastDays,
  lookbackMonths: number,
  todayIso: string = todayStr()
): { start: string; end: string } {
  const [y, m, d] = todayIso.split("-").map(Number);
  const today = new Date(y, m - 1, d);
  const end = addDaysToIsoDate(todayIso, forecastDays);
  const start = new Date(today.getFullYear(), today.getMonth() - lookbackMonths, 1);
  const sy = start.getFullYear();
  const sm = String(start.getMonth() + 1).padStart(2, "0");
  const sd = String(start.getDate()).padStart(2, "0");
  return { start: `${sy}-${sm}-${sd}`, end };
}

export function monthBounds(year: number, month: number): { start: string; end: string } {
  const mm = String(month + 1).padStart(2, "0");
  const lastDay = new Date(year, month + 1, 0).getDate();
  return {
    start: `${year}-${mm}-01`,
    end: `${year}-${mm}-${String(lastDay).padStart(2, "0")}`,
  };
}

export function buildMonthGrid(year: number, month: number): (string | null)[] {
  const first = new Date(year, month, 1);
  const startPad = first.getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: (string | null)[] = [];
  for (let i = 0; i < startPad; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) {
    const m = String(month + 1).padStart(2, "0");
    const day = String(d).padStart(2, "0");
    cells.push(`${year}-${m}-${day}`);
  }
  while (cells.length % CALENDAR_WEEKDAY_COLUMNS !== 0) cells.push(null);
  return cells;
}

/** Fixed compact height for every calendar day cell (does not vary by week count). */
export const CALENDAR_DAY_CELL_HEIGHT = 54;

export const CALENDAR_WEEKDAY_COLUMNS = 7;

export function calendarGridWeekCount(grid: (string | null)[]): number {
  if (grid.length === 0 || grid.length % CALENDAR_WEEKDAY_COLUMNS !== 0) return 0;
  return grid.length / CALENDAR_WEEKDAY_COLUMNS;
}

export function calendarGridWeekRow(grid: (string | null)[], rowIndex: number): (string | null)[] {
  const start = rowIndex * CALENDAR_WEEKDAY_COLUMNS;
  return grid.slice(start, start + CALENDAR_WEEKDAY_COLUMNS);
}

export function monthLabel(year: number, month: number): string {
  return new Date(year, month, 1).toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
  });
}

export function dayMap(days: TimelineCalendarDay[]): Map<string, TimelineCalendarDay> {
  return new Map(days.map((day) => [day.date, day]));
}

export function emptyCalendarDay(dateIso: string): TimelineCalendarDay {
  return {
    date: dateIso,
    income_total: "0",
    expense_total: "0",
    transfer_total: "0",
    net_total: "0",
    ending_balance: "0",
    lowest_balance: "0",
    risk_level: "none",
    risk_reason: null,
    has_risk: false,
    heat_level: "neutral",
    transactions: [],
  };
}

export function dayHasActivity(day: TimelineCalendarDay): boolean {
  return (
    parseCalendarAmount(day.income_total) !== 0 ||
    parseCalendarAmount(day.expense_total) !== 0 ||
    parseCalendarAmount(day.transfer_total) !== 0 ||
    day.transactions.length > 0
  );
}

export type DaySeverity = "neutral" | "healthy" | "watch" | "critical";

export function daySeverity(day: TimelineCalendarDay): DaySeverity {
  if (day.is_negative || day.has_risk || day.risk_level === "critical") return "critical";
  if (day.heat_level === "dangerous") return "critical";
  if (day.heat_level === "tight" || parseCalendarAmount(day.lowest_balance) < 0) return "watch";
  if (day.heat_level === "healthy" || dayHasActivity(day)) return "healthy";
  return "neutral";
}

export function daySeverityLabel(severity: DaySeverity): string {
  switch (severity) {
    case "critical":
      return "Financial risk";
    case "watch":
      return "Tight balance";
    case "healthy":
      return "Healthy";
    default:
      return "No activity";
  }
}

export function dayAccessibilityLabel(day: TimelineCalendarDay, dateIso: string): string {
  const severity = daySeverityLabel(daySeverity(day));
  const events = day.transactions.length;
  const net = parseCalendarAmount(day.net_total);
  const parts = [
    dateIso,
    severity,
    events > 0 ? `${events} events` : "no events",
  ];
  if (net !== 0) parts.push(`net ${net.toFixed(2)}`);
  if (day.is_negative) parts.push("negative balance projected");
  return parts.join(", ");
}

export function isDateWithinForecast(dateIso: string, forecastDays: number, today = todayStr()): boolean {
  const forecastEnd = addDaysToIsoDate(today, forecastDays);
  return dateIso >= today && dateIso <= forecastEnd;
}

export function isDateBeforeLookback(dateIso: string, lookbackMonths: number, today = todayStr()): boolean {
  const [y, m] = today.split("-").map(Number);
  const earliest = new Date(y, m - 1 - lookbackMonths, 1);
  const earliestIso = `${earliest.getFullYear()}-${String(earliest.getMonth() + 1).padStart(2, "0")}-01`;
  return dateIso < earliestIso;
}

export function filterCalendarTransactions(
  transactions: TimelineCalendarTransaction[],
  filter: { flow: "all" | "income" | "expense" | "transfer"; recurringOnly: boolean }
): TimelineCalendarTransaction[] {
  return transactions.filter((txn) => {
    if (filter.recurringOnly && !txn.rule_id) return false;
    const amount = parseCalendarAmount(txn.amount);
    if (filter.flow === "income") return amount > 0 && !txn.is_transfer;
    if (filter.flow === "expense") return amount < 0 && !txn.is_transfer;
    if (filter.flow === "transfer") return txn.is_transfer;
    return true;
  });
}

export function shiftMonth(year: number, month: number, delta: number): { year: number; month: number } {
  const d = new Date(year, month + delta, 1);
  return { year: d.getFullYear(), month: d.getMonth() };
}
