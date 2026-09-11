import type { QueryClient } from "@tanstack/react-query";

/** Batch timeline rebuilds on Reconcile — not used for Transactions balance edits. */
const TIMELINE_DEBOUNCE_MS = 2500;
const ACCOUNTS_DEBOUNCE_MS = 4000;

let timelineTimer: ReturnType<typeof setTimeout> | null = null;
let accountsTimer: ReturnType<typeof setTimeout> | null = null;
let timelineRefreshClient: QueryClient | null = null;
let accountsRefreshClient: QueryClient | null = null;

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
  ["dti"],
  ["onboarding"],
  ["projected-funds-alerts"],
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
  timelineRefreshClient = queryClient;
  timelineTimer = setTimeout(() => {
    timelineTimer = null;
    const client = timelineRefreshClient;
    timelineRefreshClient = null;
    if (client) void client.refetchQueries({ queryKey: ["timeline"], type: "active" });
  }, delayMs);
}

export function scheduleAccountsRefresh(
  queryClient: QueryClient,
  delayMs = ACCOUNTS_DEBOUNCE_MS
): void {
  if (accountsTimer) clearTimeout(accountsTimer);
  accountsRefreshClient = queryClient;
  accountsTimer = setTimeout(() => {
    accountsTimer = null;
    const client = accountsRefreshClient;
    accountsRefreshClient = null;
    if (!client) return;
    void client.refetchQueries({ queryKey: ["accounts"], type: "active" });
    void client.refetchQueries({ queryKey: ["account"], type: "active" });
    void client.refetchQueries({ queryKey: ["dashboard-summary"], type: "active" });
    void client.refetchQueries({ queryKey: ["dashboard-summary-fast"], type: "active" });
    void client.refetchQueries({ queryKey: ["dashboard-summary-details"], type: "active" });
    void client.refetchQueries({ queryKey: ["extended-cash-risk"], type: "active" });
    void client.refetchQueries({ queryKey: ["recommendations"], type: "active" });
  }, delayMs);
}

/** Drop pending Reconcile debounce timers so they cannot fire against a stale QueryClient. */
export function cancelScheduledFinancialRefresh(): void {
  if (timelineTimer) {
    clearTimeout(timelineTimer);
    timelineTimer = null;
  }
  if (accountsTimer) {
    clearTimeout(accountsTimer);
    accountsTimer = null;
  }
  timelineRefreshClient = null;
  accountsRefreshClient = null;
}

/** Immediate refresh after a transaction edit — invalidate once; active queries refetch once. */
export function refreshAfterTransactionEdit(
  queryClient: QueryClient,
  opts?: {
    refreshTimeline?: boolean;
    refreshAccounts?: boolean;
    skipTransactionsInvalidate?: boolean;
  }
): void {
  void opts;
  void queryClient.cancelQueries({ queryKey: ["timeline"] });
  invalidateFinancialQueries(queryClient);
}

export function flushFinancialRefresh(queryClient: QueryClient): void {
  cancelScheduledFinancialRefresh();
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
