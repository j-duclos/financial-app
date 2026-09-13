import type { OperationalForecastDays } from "@budget-app/shared";
import { addDaysToIsoDate, addMonthsToIsoDate, maxIsoDate, todayStr } from "./dates";

export type TimeFilter =
  | "7d"
  | "14d"
  | "30d"
  | "60d"
  | "90d"
  | "1m"
  | "3m"
  | "6m"
  | "12m"
  | "18m"
  | "24m"
  | "36m"
  | "all";

/** Default Recent historical window on mobile Transactions. */
export const DEFAULT_TIME_FILTER: TimeFilter = "7d";

/**
 * History range chips on the Transactions filter sheet and Recent header.
 * Not plan-gated — Free and Premium can open all available ledger history.
 */
export const RECENT_RANGE_OPTIONS: TimeFilter[] = ["7d", "14d", "30d", "90d", "12m", "all"];

export const TIME_FILTER_LABELS: Record<TimeFilter, string> = {
  "7d": "7 days",
  "14d": "14 days",
  "30d": "30 days",
  "60d": "60 days",
  "90d": "90 days",
  "1m": "1 month",
  "3m": "3 months",
  "6m": "6 months",
  "12m": "1 year",
  "18m": "18 months",
  "24m": "24 months",
  "36m": "36 months",
  all: "All history",
};

const TIME_FILTER_DAYS: Partial<Record<TimeFilter, number>> = {
  "7d": 7,
  "14d": 14,
  "30d": 30,
  "60d": 60,
  "90d": 90,
};

const TIME_FILTER_MONTHS: Record<
  Exclude<TimeFilter, "7d" | "14d" | "30d" | "60d" | "90d" | "all">,
  number
> = {
  "1m": 1,
  "3m": 3,
  "6m": 6,
  "12m": 12,
  "18m": 18,
  "24m": 24,
  "36m": 36,
};

export function isTimeFilter(value: string | null | undefined): value is TimeFilter {
  return typeof value === "string" && value in TIME_FILTER_LABELS;
}

export function isUnboundedHistoryFilter(filter: TimeFilter): boolean {
  return filter === "all";
}

/**
 * Windows that may exceed one ledger page. Fetch newest-first so Recent stays
 * adjacent to Pending; older pages load on demand instead of dumping the archive.
 */
export function usesNewestFirstHistoryPagination(filter: TimeFilter): boolean {
  return filter === "all" || filter === "12m";
}

/** Past window for listTransactions (history through today). Empty start = all history. */
export function pastTransactionsRange(filter: TimeFilter): { start: string; end: string } {
  const today = todayStr();
  if (isUnboundedHistoryFilter(filter)) {
    return { start: "", end: today };
  }
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
      return filterStart ? maxIsoDate(filterStart, floor) : floor;
    }
    if (floor && floor < periodEnd) {
      return filterStart ? maxIsoDate(filterStart, dayAfterClose) : dayAfterClose;
    }
    if (floor && floor > periodEnd) {
      return filterStart ? maxIsoDate(filterStart, floor) : floor;
    }
    return filterStart ? maxIsoDate(filterStart, dayAfterClose) : dayAfterClose;
  }

  if (floor) return filterStart ? maxIsoDate(filterStart, floor) : floor;
  return filterStart;
}

/**
 * Concatenate infinite-query history pages into ledger order.
 * Newest-first API pages are reversed so Recent still runs oldest → newest.
 */
export function flattenLedgerHistoryPages<T>(
  pages: ReadonlyArray<{ results: T[] }> | undefined,
  newestFirst: boolean
): T[] {
  const rows = pages?.flatMap((page) => page.results) ?? [];
  if (!newestFirst || rows.length <= 1) return rows;
  return rows.slice().reverse();
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
  if (isUnboundedHistoryFilter(filter)) return TIME_FILTER_LABELS.all;
  return `Last ${TIME_FILTER_LABELS[filter]}`;
}

export function upcomingRangeLabel(days: number): string {
  return `Next ${days} days`;
}
