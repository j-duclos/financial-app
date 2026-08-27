import type { TransactionFilters } from "./types";
import type { TimeFilter } from "@/lib/transactionsLedger";

export const transactionQueryKeys = {
  all: ["transactions"] as const,
  list: (params: Record<string, unknown>) => ["transactions", "list", params] as const,
  detail: (id: number) => ["transactions", "detail", id] as const,
  timeline: (params: Record<string, unknown>) => ["timeline", "ledger", params] as const,
  reconcileSetup: (accountId: number) => ["reconcile-setup", accountId, "transactions-ledger"] as const,
  accountsPicker: ["account-options"] as const,
  categories: (householdId: number | null) => ["category-options", householdId] as const,
};

export function transactionListQueryParams(input: {
  accountId: number | null;
  categoryId: number | null;
  dateAfter: string;
  dateBefore: string;
  showReconciled: boolean;
  historyStart: string;
  search: string;
}): Record<string, unknown> {
  return {
    account: input.accountId ?? undefined,
    category: input.categoryId ?? undefined,
    date_after: input.dateAfter,
    date_before: input.dateBefore,
    showReconciled: input.showReconciled,
    include_reconciled_after: input.showReconciled ? input.historyStart : undefined,
    search: input.search.trim() || undefined,
  };
}

export function timelineQueryParams(input: {
  start: string;
  end: string;
  accountId: number | null;
  hideReconciledPast: boolean;
}): Record<string, unknown> {
  return {
    start: input.start,
    end: input.end,
    account_id: input.accountId ?? undefined,
    exclude_reconciled_past: input.hideReconciledPast,
  };
}

export function filtersFromSearchParams(params: {
  account?: string;
  category?: string;
  timeFilter?: string;
  date?: string;
  dateFrom?: string;
  dateTo?: string;
}): Partial<TransactionFilters> {
  const next: Partial<TransactionFilters> = {};
  const accountId = Number(params.account);
  if (Number.isInteger(accountId) && accountId > 0) next.accountId = accountId;
  const categoryId = Number(params.category);
  if (Number.isInteger(categoryId) && categoryId > 0) next.categoryId = categoryId;
  const tf = params.timeFilter as TimeFilter | undefined;
  if (tf) next.timeFilter = tf;
  if (params.date && /^\d{4}-\d{2}-\d{2}$/.test(params.date)) {
    next.specificDate = params.date;
  }
  if (params.dateFrom && /^\d{4}-\d{2}-\d{2}$/.test(params.dateFrom)) {
    next.dateFrom = params.dateFrom;
  }
  if (params.dateTo && /^\d{4}-\d{2}-\d{2}$/.test(params.dateTo)) {
    next.dateTo = params.dateTo;
  }
  return next;
}
