import type { TimeFilter } from "@/lib/transactionsLedger";

export type TransactionFlowFilter = "all" | "income" | "expense" | "transfer";
export type TransactionClearedFilter = "all" | "cleared" | "pending";
export type TransactionForecastFilter = "all" | "forecast" | "posted";

export type TransactionFilters = {
  accountId: number | null;
  categoryId: number | null;
  timeFilter: TimeFilter;
  /** When set, list/timeline queries filter to this single day (calendar deep link). */
  specificDate: string | null;
  /** When set, list queries filter to this inclusive date range (budget deep link). */
  dateFrom: string | null;
  dateTo: string | null;
  showReconciled: boolean;
  flow: TransactionFlowFilter;
  cleared: TransactionClearedFilter;
  forecast: TransactionForecastFilter;
  search: string;
  amountMin: number | null;
  amountMax: number | null;
};

/** First-page size for mobile transaction list and Attention prefetch (same query key). */
export const TRANSACTIONS_LIST_PAGE_SIZE = 15;

/** Bounded Recent ledger page — large enough for a typical 14–90 day window in one request. */
export const TRANSACTIONS_LEDGER_PAGE_SIZE = 500;

/** Ascending ledger order matching backend running-balance walk (date, then id). */
export const TRANSACTIONS_LEDGER_ORDERING = "date,id";

export const DEFAULT_TRANSACTION_FILTERS: TransactionFilters = {
  accountId: null,
  categoryId: null,
  timeFilter: "14d",
  specificDate: null,
  dateFrom: null,
  dateTo: null,
  showReconciled: false,
  flow: "all",
  cleared: "all",
  forecast: "all",
  search: "",
  amountMin: null,
  amountMax: null,
};

/** Clear ledger filters but keep the selected account (account is navigation, not a filter). */
export function clearTransactionFiltersPreservingAccount(accountId: number | null): TransactionFilters {
  return { ...DEFAULT_TRANSACTION_FILTERS, accountId };
}

export function countActiveTransactionFilters(filters: TransactionFilters): number {
  let n = 0;
  if (filters.categoryId != null) n += 1;
  if (filters.specificDate) n += 1;
  else if (filters.dateFrom || filters.dateTo) n += 1;
  else if (filters.timeFilter !== "14d") n += 1;
  if (filters.showReconciled) n += 1;
  if (filters.flow !== "all") n += 1;
  if (filters.forecast !== "all") n += 1;
  if (filters.amountMin != null || filters.amountMax != null) n += 1;
  return n;
}

export function parseAmountFilterInput(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const n = parseFloat(trimmed.replace(/[$,]/g, ""));
  return Number.isFinite(n) && n >= 0 ? n : null;
}
