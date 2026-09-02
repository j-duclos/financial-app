import type { QueryClient } from "@tanstack/react-query";

/** Batch timeline rebuilds on Reconcile — not used for Transactions balance edits. */
const TIMELINE_DEBOUNCE_MS = 2500;
const ACCOUNTS_DEBOUNCE_MS = 4000;

let timelineTimer: ReturnType<typeof setTimeout> | null = null;
let accountsTimer: ReturnType<typeof setTimeout> | null = null;

/** Query prefixes that must go stale after a financial mutation. */
export const FINANCIAL_QUERY_PREFIXES = [
  ["transactions"],
  ["timeline"],
  ["timeline-calendar"],
  ["calendar-summary"],
  ["calendar-chunk"],
  ["calendar-timeline-upcoming"],
  ["accounts"],
  ["account"],
  ["dashboard-summary"],
  ["dashboard-summary-fast"],
  ["dashboard-summary-details"],
  ["extended-cash-risk"],
  ["recommendations"],
  ["debt-plan"],
  ["account-payoff"],
  ["bills-overview"],
  ["bill-detail"],
  ["recurring-rules-summary"],
  ["subscription-intelligence"],
] as const;

/** Preference-only invalidation when credit utilization target changes (not a ledger mutation). */
export const UTILIZATION_PREFERENCE_QUERY_PREFIXES = [
  ["recommendations"],
  ["dashboard-summary"],
  ["dashboard-summary-fast"],
  ["dashboard-summary-details"],
  ["debt-plan"],
  ["account-payoff"],
] as const;

export function invalidateFinancialQueries(queryClient: QueryClient): void {
  for (const queryKey of FINANCIAL_QUERY_PREFIXES) {
    void queryClient.invalidateQueries({ queryKey: [...queryKey] });
  }
}

export function invalidateUtilizationPreferenceQueries(queryClient: QueryClient): void {
  for (const queryKey of UTILIZATION_PREFERENCE_QUERY_PREFIXES) {
    void queryClient.invalidateQueries({ queryKey: [...queryKey] });
  }
}

export function scheduleTimelineRefresh(
  queryClient: QueryClient,
  delayMs = TIMELINE_DEBOUNCE_MS
): void {
  if (timelineTimer) clearTimeout(timelineTimer);
  timelineTimer = setTimeout(() => {
    timelineTimer = null;
    void queryClient.refetchQueries({ queryKey: ["timeline"], type: "active" });
  }, delayMs);
}

export function scheduleAccountsRefresh(
  queryClient: QueryClient,
  delayMs = ACCOUNTS_DEBOUNCE_MS
): void {
  if (accountsTimer) clearTimeout(accountsTimer);
  accountsTimer = setTimeout(() => {
    accountsTimer = null;
    void queryClient.refetchQueries({ queryKey: ["accounts"], type: "active" });
    void queryClient.refetchQueries({ queryKey: ["account"], type: "active" });
    void queryClient.refetchQueries({ queryKey: ["dashboard-summary"], type: "active" });
    void queryClient.refetchQueries({ queryKey: ["dashboard-summary-fast"], type: "active" });
    void queryClient.refetchQueries({ queryKey: ["dashboard-summary-details"], type: "active" });
    void queryClient.refetchQueries({ queryKey: ["extended-cash-risk"], type: "active" });
    void queryClient.refetchQueries({ queryKey: ["recommendations"], type: "active" });
  }, delayMs);
}

/** Immediate refresh after a transaction edit — authoritative timeline and account balances. */
export function refreshAfterTransactionEdit(
  queryClient: QueryClient,
  opts?: {
    refreshTimeline?: boolean;
    refreshAccounts?: boolean;
    skipTransactionsInvalidate?: boolean;
  }
): void {
  invalidateFinancialQueries(queryClient);
  if (!opts?.skipTransactionsInvalidate) {
    void queryClient.refetchQueries({ queryKey: ["transactions"], type: "active" });
  }
  if (opts?.refreshTimeline !== false) {
    void queryClient.cancelQueries({ queryKey: ["timeline"] });
    void queryClient.refetchQueries({ queryKey: ["timeline"], type: "active" });
  }
  if (opts?.refreshAccounts) {
    void queryClient.refetchQueries({ queryKey: ["accounts"], type: "active" });
    void queryClient.refetchQueries({ queryKey: ["account"], type: "active" });
    void queryClient.refetchQueries({ queryKey: ["dashboard-summary"], type: "active" });
    void queryClient.refetchQueries({ queryKey: ["dashboard-summary-fast"], type: "active" });
    void queryClient.refetchQueries({ queryKey: ["dashboard-summary-details"], type: "active" });
    void queryClient.refetchQueries({ queryKey: ["extended-cash-risk"], type: "active" });
    void queryClient.refetchQueries({ queryKey: ["recommendations"], type: "active" });
  }
}

export function flushFinancialRefresh(queryClient: QueryClient): void {
  if (timelineTimer) {
    clearTimeout(timelineTimer);
    timelineTimer = null;
  }
  if (accountsTimer) {
    clearTimeout(accountsTimer);
    accountsTimer = null;
  }
  invalidateFinancialQueries(queryClient);
}

/** Recurring-rule mutations affect forecasts; mark dependents stale (active screens refetch). */
export function invalidateRecurringRuleDependents(queryClient: QueryClient): void {
  void queryClient.invalidateQueries({ queryKey: ["rules"] });
  void queryClient.invalidateQueries({ queryKey: ["recurring-rules"] });
  void queryClient.invalidateQueries({ queryKey: ["recurring-rules-summary"] });
  void queryClient.invalidateQueries({ queryKey: ["scenarios"] });
  invalidateFinancialQueries(queryClient);
}

/** Spending-limit definition changes — budget summaries, reports, dashboard/recommendations. */
export function invalidateSpendingTargetDependents(queryClient: QueryClient): void {
  void queryClient.invalidateQueries({ queryKey: ["spending-targets"] });
  void queryClient.invalidateQueries({ queryKey: ["spending-targets-summary"] });
  void queryClient.invalidateQueries({ queryKey: ["spending-target"] });
  void queryClient.invalidateQueries({ queryKey: ["dashboard-summary"] });
  void queryClient.invalidateQueries({ queryKey: ["dashboard-summary-fast"] });
  void queryClient.invalidateQueries({ queryKey: ["dashboard-summary-details"] });
  void queryClient.invalidateQueries({ queryKey: ["recommendations"] });
  void queryClient.invalidateQueries({ queryKey: ["monthly-reports"] });
}
