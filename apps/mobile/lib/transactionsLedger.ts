import type { OperationalForecastDays } from "@budget-app/shared";
import { addDaysToIsoDate, addMonthsToIsoDate, maxIsoDate, todayStr } from "./dates";

export type TimeFilter = "14d" | "30d" | "60d" | "90d" | "1m" | "3m" | "6m" | "12m" | "18m" | "24m" | "36m";

/** Default Recent historical window on mobile Transactions. */
export const DEFAULT_TIME_FILTER: TimeFilter = "14d";

/** Compact Recent range options shown on the ledger section header. */
export const RECENT_RANGE_OPTIONS: TimeFilter[] = ["14d", "30d", "60d", "90d"];

export const TIME_FILTER_LABELS: Record<TimeFilter, string> = {
  "14d": "14 days",
  "30d": "30 days",
  "60d": "60 days",
  "90d": "90 days",
  "1m": "1 month",
  "3m": "3 months",
  "6m": "6 months",
  "12m": "12 months",
  "18m": "18 months",
  "24m": "24 months",
  "36m": "36 months",
};

const TIME_FILTER_DAYS: Partial<Record<TimeFilter, number>> = {
  "14d": 14,
  "30d": 30,
  "60d": 60,
  "90d": 90,
};

const TIME_FILTER_MONTHS: Record<Exclude<TimeFilter, "14d" | "30d" | "60d" | "90d">, number> = {
  "1m": 1,
  "3m": 3,
  "6m": 6,
  "12m": 12,
  "18m": 18,
  "24m": 24,
  "36m": 36,
};

/** Past window for listTransactions (history through today). */
export function pastTransactionsRange(filter: TimeFilter): { start: string; end: string } {
  const today = todayStr();
  const days = TIME_FILTER_DAYS[filter];
  if (days != null) {
    return { start: addDaysToIsoDate(today, -days), end: today };
  }
  const months = TIME_FILTER_MONTHS[filter as keyof typeof TIME_FILTER_MONTHS];
  return { start: addMonthsToIsoDate(today, -months), end: today };
}

/**
 * First date for listTransactions when hide reconciled is on.
 * Uses reconcile checkpoint metadata from the backend — never recomputes from partial pages.
 */
export function ledgerPastTransactionStart(
  filter: TimeFilter,
  hideReconciledPast: boolean,
  reconcileMeta: {
    min_start_date?: string | null;
    last_reconcile_period_end?: string | null;
  } | null | undefined
): string {
  const { start: filterStart } = pastTransactionsRange(filter);
  if (!hideReconciledPast) return filterStart;

  const periodEnd = reconcileMeta?.last_reconcile_period_end ?? null;
  const floor = reconcileMeta?.min_start_date ?? null;

  if (periodEnd) {
    const dayAfterClose = addDaysToIsoDate(periodEnd, 1);
    if (floor && floor === periodEnd) {
      return maxIsoDate(filterStart, floor);
    }
    if (floor && floor < periodEnd) {
      return maxIsoDate(filterStart, dayAfterClose);
    }
    if (floor && floor > periodEnd) {
      return maxIsoDate(filterStart, floor);
    }
    return maxIsoDate(filterStart, dayAfterClose);
  }

  if (floor) return maxIsoDate(filterStart, floor);
  return filterStart;
}

/** Upcoming projection window: today through today + forecast days. */
export function ledgerProjectionRange(
  forecastDays: OperationalForecastDays,
  asOf: string = todayStr()
): { start: string; end: string } {
  return { start: asOf, end: addDaysToIsoDate(asOf, forecastDays) };
}

export function isTransferCategoryName(name: string | undefined): boolean {
  return name === "Transfer" || name === "Bank Transfer" || name === "Credit Card Payment";
}

export function recentRangeLabel(filter: TimeFilter): string {
  return `Last ${TIME_FILTER_LABELS[filter]}`;
}

export function upcomingRangeLabel(days: number): string {
  return `Next ${days} days`;
}
