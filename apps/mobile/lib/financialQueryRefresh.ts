import type { QueryClient } from "@tanstack/react-query";

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
  ["reconcile-setup"],
  ["rules"],
  ["recurring-rules"],
  ["bills-overview"],
  ["spending-targets"],
  ["spending-targets-summary"],
  ["spending-target"],
  ["monthly-reports"],
] as const;

export function invalidateFinancialQueries(queryClient: QueryClient): void {
  for (const queryKey of FINANCIAL_QUERY_PREFIXES) {
    void queryClient.invalidateQueries({ queryKey: [...queryKey] });
  }
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
    void queryClient.refetchQueries({ queryKey: ["dashboard-summary-fast"], type: "active" });
    void queryClient.refetchQueries({ queryKey: ["dashboard-summary-details"], type: "active" });
    void queryClient.refetchQueries({ queryKey: ["extended-cash-risk"], type: "active" });
  }
}

/** Recurring-rule mutations affect forecasts; mark dependents stale (active screens refetch). */
export function invalidateRecurringRuleDependents(queryClient: QueryClient): void {
  void queryClient.invalidateQueries({ queryKey: ["rules"] });
  void queryClient.invalidateQueries({ queryKey: ["recurring-rules"] });
  void queryClient.invalidateQueries({ queryKey: ["bills-overview"] });
  invalidateFinancialQueries(queryClient);
}

/** Spending-limit mutations affect budget summaries and dashboard. */
export function invalidateSpendingTargetDependents(queryClient: QueryClient): void {
  void queryClient.invalidateQueries({ queryKey: ["spending-targets"] });
  void queryClient.invalidateQueries({ queryKey: ["spending-targets-summary"] });
  void queryClient.invalidateQueries({ queryKey: ["spending-target"] });
  void queryClient.invalidateQueries({ queryKey: ["dashboard-summary"] });
  void queryClient.invalidateQueries({ queryKey: ["dashboard-summary-fast"] });
  void queryClient.invalidateQueries({ queryKey: ["dashboard-summary-details"] });
  invalidateFinancialQueries(queryClient);
}
