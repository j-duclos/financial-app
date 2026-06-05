import type {
  BillChecklistStatus,
  TimelineCalendarDay,
  TimelineCalendarRiskLevel,
  TimelineCalendarTransaction,
  TimelineRow,
} from "@budget-app/shared";
import { resolveBillPaymentStatus } from "./billPaymentStatus";
import { formatDateDisplay } from "./dateDisplay";
import { resolveDayHeatLevel } from "./dayHeatDisplay";
import {
  forecastSeverityCellClass,
  forecastSeverityDotClass,
  type ForecastSeverity,
} from "./forecastSeverity";
import {
  groupItemsByMonth,
  monthLabelFromKey,
  type MonthGroup,
} from "./monthGroupDisplay";

export type TimelineViewMode = "calendar" | "list";

export type TimelineHorizon = "14d" | "3m" | "6m" | "12m" | "24m";

export type TimelineLookbackMonths = 0 | 1 | 2 | 3;

export const DEFAULT_TIMELINE_VIEW: TimelineViewMode = "calendar";

const HORIZON_DAYS: Record<TimelineHorizon, number> = {
  "14d": 14,
  "3m": 90,
  "6m": 180,
  "12m": 365,
  "24m": 730,
};

export function todayIsoDate(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Smallest timeline horizon that includes focusDate on or after today. */
export function pickHorizonForFocusDate(focusDateIso: string, todayIso = todayIsoDate()): TimelineHorizon {
  const today = new Date(`${todayIso}T12:00:00`);
  const focus = new Date(`${focusDateIso}T12:00:00`);
  const daysAhead = Math.ceil((focus.getTime() - today.getTime()) / (24 * 60 * 60 * 1000));
  if (daysAhead <= HORIZON_DAYS["14d"]) return "14d";
  if (daysAhead <= HORIZON_DAYS["3m"]) return "3m";
  if (daysAhead <= HORIZON_DAYS["6m"]) return "6m";
  if (daysAhead <= HORIZON_DAYS["12m"]) return "12m";
  return "24m";
}

export function isIsoDateString(value: string | null): value is string {
  return !!value && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export function timelineDayForDate(
  days: TimelineCalendarDay[],
  dateIso: string
): TimelineCalendarDay {
  const existing = days.find((d) => d.date === dateIso);
  if (existing) return existing;
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

export function parseAmount(val: string | null | undefined): number {
  if (val == null || val === "") return 0;
  const n = parseFloat(val);
  return Number.isFinite(n) ? n : 0;
}

export function dayHasActivity(day: TimelineCalendarDay): boolean {
  return (
    parseAmount(day.income_total) !== 0 ||
    parseAmount(day.expense_total) !== 0 ||
    parseAmount(day.transfer_total) !== 0 ||
    day.transactions.length > 0
  );
}

export type CalendarCellTone = "empty" | "healthy" | "watch" | "critical";

export function calendarCellTone(day: TimelineCalendarDay): CalendarCellTone {
  const heat = resolveDayHeatLevel(day);
  if (heat === "neutral" && !dayHasActivity(day)) return "empty";
  if (heat === "dangerous") return "critical";
  if (heat === "tight") return "watch";
  if (heat === "healthy") return "healthy";
  return "empty";
}

export function calendarCellToneClass(tone: CalendarCellTone, severity?: ForecastSeverity, hasActivity?: boolean): string {
  if (severity != null) {
    return forecastSeverityCellClass(severity, hasActivity ?? tone !== "empty");
  }
  switch (tone) {
    case "healthy":
      return forecastSeverityCellClass("healthy", true);
    case "watch":
      return forecastSeverityCellClass("tight", true);
    case "critical":
      return forecastSeverityCellClass("dangerous", true);
    default:
      return forecastSeverityCellClass("neutral", false);
  }
}

export function showRiskIcon(day: TimelineCalendarDay): boolean {
  const heat = resolveDayHeatLevel(day);
  return heat === "tight" || heat === "dangerous";
}

export function calendarDayHeatDotClass(day: TimelineCalendarDay): string {
  return forecastSeverityDotClass(resolveDayHeatLevel(day));
}

export function formatCompactMonthDay(dateIso: string): string {
  return formatDateDisplay(dateIso);
}

export function formatCompactNet(netTotal: string): string {
  const n = parseAmount(netTotal);
  const abs = Math.abs(n);
  const prefix = n < 0 ? "-" : n > 0 ? "+" : "";
  return `Net cash flow ${prefix}$${abs.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

export function formatCompactEnd(endingBalance: string): string {
  const n = parseAmount(endingBalance);
  return `Ending balance $${Math.round(n).toLocaleString("en-US")}`;
}

export function formatShortMoney(amount: string | number, signed = false): string {
  const n = typeof amount === "number" ? amount : parseAmount(amount);
  const abs = Math.abs(n);
  const prefix = signed ? (n >= 0 ? "+" : "-") : "";
  return `${prefix}$${abs.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

export function groupTransactionsByKind(transactions: TimelineCalendarTransaction[]) {
  const income: TimelineCalendarTransaction[] = [];
  const expenses: TimelineCalendarTransaction[] = [];
  const transfers: TimelineCalendarTransaction[] = [];
  for (const t of transactions) {
    if (t.is_transfer) {
      transfers.push(t);
    } else if (parseAmount(t.amount) > 0) {
      income.push(t);
    } else {
      expenses.push(t);
    }
  }
  return { income, expenses, transfers };
}

/** Build month grid cells (null = padding before month start). */
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
  return cells;
}

export function monthsInRange(startDate: string, endDate: string): { year: number; month: number; label: string }[] {
  const start = new Date(`${startDate}T12:00:00`);
  const end = new Date(`${endDate}T12:00:00`);
  const out: { year: number; month: number; label: string }[] = [];
  const cur = new Date(start.getFullYear(), start.getMonth(), 1);
  const last = new Date(end.getFullYear(), end.getMonth(), 1);
  while (cur <= last) {
    out.push({
      year: cur.getFullYear(),
      month: cur.getMonth(),
      label: cur.toLocaleDateString("en-US", { month: "long", year: "numeric" }),
    });
    cur.setMonth(cur.getMonth() + 1);
  }
  return out;
}

export function dayMap(days: TimelineCalendarDay[]): Map<string, TimelineCalendarDay> {
  return new Map(days.map((d) => [d.date, d]));
}

export function riskLevelLabel(level: TimelineCalendarRiskLevel): string {
  if (level === "critical") return "Critical";
  if (level === "watch") return "Watch";
  return "OK";
}

export type TimelineDayGroup = { date: string; rows: TimelineRow[] };

/** Drop historical rows before the calendar horizon start (today). */
export function filterTimelineFromDate(rows: TimelineRow[], startDateIso: string): TimelineRow[] {
  return rows.filter((row) => row.date >= startDateIso);
}

/** Group list rows by date for list view. */
export function groupTimelineRowsByDate(rows: TimelineRow[]): TimelineDayGroup[] {
  const map = new Map<string, TimelineRow[]>();
  for (const row of rows) {
    const list = map.get(row.date) ?? [];
    list.push(row);
    map.set(row.date, list);
  }
  return [...map.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, dateRows]) => ({ date, rows: dateRows }));
}

/** Income / expense / net from raw timeline rows (fallback when calendar day missing). */
export function dayTotalsFromTimelineRows(rows: TimelineRow[]) {
  let income = 0;
  let expense = 0;
  for (const row of rows) {
    const amt = parseAmount(row.amount);
    if (amt > 0) income += amt;
    else if (amt < 0) expense += Math.abs(amt);
  }
  return {
    income_total: income.toFixed(2),
    expense_total: expense.toFixed(2),
    net_total: (income - expense).toFixed(2),
  };
}

/** Household ending balance from the last running balance per account on a day. */
export function endingBalanceFromTimelineRows(rows: TimelineRow[]): string {
  if (rows.length === 0) return "0";
  const lastByAccount = new Map<number, string>();
  for (const row of rows) {
    lastByAccount.set(row.account_id, row.running_balance);
  }
  let sum = 0;
  for (const balance of lastByAccount.values()) {
    sum += parseAmount(balance);
  }
  return sum.toFixed(2);
}

/** Per-row balance after from calendar day data (matches summary / lowest-balance markers). */
export function timelineRowBalanceAfter(
  row: TimelineRow,
  day: TimelineCalendarDay | undefined
): string | null {
  const txns = day?.transactions;
  if (!txns?.length) return null;

  if (row.transaction_id != null) {
    const hit = txns.find((t) => String(t.id) === String(row.transaction_id));
    if (hit?.balance_after != null) return hit.balance_after;
  }

  if (row.rule_id != null) {
    const projectedId = `r-${row.rule_id}-${row.date}`;
    const hit = txns.find((t) => String(t.id) === projectedId);
    if (hit?.balance_after != null) return hit.balance_after;
  }

  const rowAmt = parseAmount(row.amount);
  const hit = txns.find(
    (t) =>
      (t.account_id == null || t.account_id === row.account_id) &&
      parseAmount(t.amount ?? "0") === rowAmt &&
      t.description === row.description
  );
  return hit?.balance_after ?? null;
}

export function resolveListDayMetrics(
  date: string,
  rows: TimelineRow[],
  calendarDays: TimelineCalendarDay[] | undefined
): { calendarDay: TimelineCalendarDay; netTotal: string; endingBalance: string } {
  const apiDay = calendarDays ? dayMap(calendarDays).get(date) : undefined;
  if (apiDay) {
    return {
      calendarDay: apiDay,
      netTotal: apiDay.net_total,
      endingBalance: apiDay.ending_balance,
    };
  }

  const rowTotals = dayTotalsFromTimelineRows(rows);
  return {
    calendarDay: timelineDayForDate(calendarDays ?? [], date),
    netTotal: rowTotals.net_total,
    endingBalance: endingBalanceFromTimelineRows(rows),
  };
}

/** Group day groups by month for sticky month separators in list view. */
export function groupTimelineDayGroupsByMonth(
  dayGroups: TimelineDayGroup[]
): MonthGroup<TimelineDayGroup>[] {
  return groupItemsByMonth(dayGroups, (g) => g.date);
}

export function monthLabelForCalendarSection(year: number, month: number): string {
  const m = String(month + 1).padStart(2, "0");
  return monthLabelFromKey(`${year}-${m}`);
}

export function hasProjectedActivity(days: TimelineCalendarDay[]): boolean {
  return days.some(dayHasActivity);
}

export type TimelineTxnStatus =
  | BillChecklistStatus
  | "projected"
  | "due_soon"
  | "paid"
  | "reconciled"
  | "skipped"
  | "late";

export function inferTimelineTransactionStatus(
  txn: TimelineCalendarTransaction,
  dueDate: string
): TimelineTxnStatus {
  return resolveBillPaymentStatus({ dueDate, txn });
}

export function determineRiskContributionLabels(
  day: TimelineCalendarDay,
  txn: TimelineCalendarTransaction
): string[] {
  const labels: string[] = [];
  const description = txn.description.trim().toLowerCase();
  const amount = parseAmount(txn.amount);
  const lowestDesc = (day.lowest_projected_balance_after_description ?? "").trim().toLowerCase();
  const heatReason = (day.heat_reason ?? day.risk_reason ?? "").toLowerCase();

  if (day.has_risk && lowestDesc && description && lowestDesc === description) {
    labels.push("Causes overdraft");
  }

  if (
    day.credit_balance_warnings?.some((w) => {
      const msg = w.message.toLowerCase();
      return msg.includes("over limit") || msg.includes("utilization");
    })
  ) {
    labels.push("Causes card utilization > 90%");
  }

  if (day.has_risk && amount < 0 && (heatReason.includes("before paycheck") || heatReason.includes("before pay"))) {
    labels.push("Occurs before next paycheck");
  }

  if (day.has_risk && amount < 0 && (day.heat_level === "tight" || day.heat_level === "dangerous")) {
    labels.push("Unsafe discretionary period");
  }

  return [...new Set(labels)];
}

export type SafeUntilSummary = {
  nextIncomeDate: string | null;
  safeAmount: number;
  unsafeDate: string | null;
  obligationsBeforeIncome: number;
  currentBalance: number;
};

/**
 * Deterministic "safe until next income":
 * current balance minus projected obligations before the next positive day.
 */
export function computeSafeUntilNextIncome(
  days: TimelineCalendarDay[],
  asOfDate: string = todayIsoDate()
): SafeUntilSummary | null {
  if (!days.length) return null;

  const today = asOfDate;
  const todayDay = days.find((d) => d.date === today);
  const anchorDay = todayDay ?? days[0];
  const currentBalance =
    parseAmount(anchorDay.ending_balance) - parseAmount(anchorDay.net_total);

  let nextIncomeDate: string | null = null;
  for (const day of days) {
    if (day.date < today) continue;
    if (
      parseAmount(day.income_total) > 0 ||
      day.transactions.some((t) => parseAmount(t.amount) > 0 && !t.is_transfer)
    ) {
      nextIncomeDate = day.date;
      break;
    }
  }

  let obligations = 0;
  let running = currentBalance;
  let unsafeDate: string | null = null;
  for (const day of days) {
    if (day.date < today) continue;
    if (nextIncomeDate && day.date >= nextIncomeDate) break;
    const outflow = Math.max(0, parseAmount(day.expense_total));
    obligations += outflow;
    running -= outflow;
    if (unsafeDate == null && running < 0) {
      unsafeDate = day.date;
    }
  }

  return {
    nextIncomeDate,
    safeAmount: currentBalance - obligations,
    unsafeDate,
    obligationsBeforeIncome: obligations,
    currentBalance,
  };
}
