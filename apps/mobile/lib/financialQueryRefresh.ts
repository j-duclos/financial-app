import type { QueryClient } from "@tanstack/react-query";
import { reconcileQueryKeys } from "@/features/reconcile/queryKeys";
import { invalidateAccountOptionsQueries } from "@/lib/referenceQueryKeys";

/**
 * Live query-key roots — prefix invalidation and logout cache clearing.
 * Keep in sync with feature `queryKeys.ts` factories.
 */
export const LIVE_QUERY_KEY_ROOTS = {
  transactions: "transactions",
  timeline: "timeline",
  calendarSummary: "calendar-summary",
  calendarChunk: "calendar-chunk",
  accounts: "accounts",
  account: "account",
  dashboardSummary: "dashboard-summary",
  dashboardSummaryFast: "dashboard-summary-fast",
  dashboardSummaryDetails: "dashboard-summary-details",
  extendedCashRisk: "extended-cash-risk",
  recommendations: "recommendations",
  resolveRisk: "resolve-risk",
  debtPlan: "debt-plan",
  accountPayoff: "account-payoff",
  rules: "rules",
  billsOverview: "bills-overview",
  billDetail: "bill-detail",
  spendingTargets: "spending-targets",
  spendingTargetsSummary: "spending-targets-summary",
  spendingTarget: "spending-target",
  spendingTargetEdit: "spending-target-edit",
  spendingTargetSuggestType: "spending-target-suggest-type",
  buckets: "buckets",
  bucketDetail: "bucket-detail",
  goalContributions: "goal-contributions",
  bucketsSummary: "buckets-summary",
  goalsReport: "goals-report",
  ruleAllocations: "rule-allocations",
  monthlyReports: "monthly-reports",
  reconcile: "reconcile",
  categories: "categories",
  accountOptions: "account-options",
  categoryOptions: "category-options",
  households: "households",
  whatIfScenarios: "what-if-scenarios",
  whatIfAccounts: "what-if-accounts",
} as const;

/** Prefixes that must never appear in mutation invalidation helpers. */
export const OBSOLETE_INVALIDATION_PREFIXES = [
  "reconcile-setup",
  "action-center",
  "what-if",
  "what-if-categories",
  "scenarios",
  "timeline-calendar",
  "calendar-timeline-upcoming",
] as const;

function invalidateRoot(queryClient: QueryClient, root: string): void {
  void queryClient.invalidateQueries({ queryKey: [root] });
}

export function invalidateLedgerQueries(queryClient: QueryClient): void {
  invalidateRoot(queryClient, LIVE_QUERY_KEY_ROOTS.transactions);
  invalidateRoot(queryClient, LIVE_QUERY_KEY_ROOTS.timeline);
  invalidateRoot(queryClient, LIVE_QUERY_KEY_ROOTS.calendarSummary);
  invalidateRoot(queryClient, LIVE_QUERY_KEY_ROOTS.calendarChunk);
}

export function invalidateForecastQueries(queryClient: QueryClient): void {
  invalidateDashboardQueries(queryClient);
  invalidateRecommendationQueries(queryClient);
  invalidateRoot(queryClient, LIVE_QUERY_KEY_ROOTS.debtPlan);
  invalidateRoot(queryClient, LIVE_QUERY_KEY_ROOTS.accountPayoff);
  invalidateRoot(queryClient, LIVE_QUERY_KEY_ROOTS.accounts);
  invalidateRoot(queryClient, LIVE_QUERY_KEY_ROOTS.account);
}

export function invalidateAccountQueries(queryClient: QueryClient): void {
  invalidateRoot(queryClient, LIVE_QUERY_KEY_ROOTS.accounts);
  invalidateRoot(queryClient, LIVE_QUERY_KEY_ROOTS.account);
  invalidateAccountOptionsQueries(queryClient);
}

export function invalidateDashboardQueries(queryClient: QueryClient): void {
  invalidateRoot(queryClient, LIVE_QUERY_KEY_ROOTS.dashboardSummary);
  invalidateRoot(queryClient, LIVE_QUERY_KEY_ROOTS.dashboardSummaryFast);
  invalidateRoot(queryClient, LIVE_QUERY_KEY_ROOTS.dashboardSummaryDetails);
  invalidateRoot(queryClient, LIVE_QUERY_KEY_ROOTS.extendedCashRisk);
}

export function invalidateRecommendationQueries(queryClient: QueryClient): void {
  invalidateRoot(queryClient, LIVE_QUERY_KEY_ROOTS.recommendations);
  invalidateRoot(queryClient, LIVE_QUERY_KEY_ROOTS.resolveRisk);
}

export function invalidateReportQueries(queryClient: QueryClient): void {
  invalidateRoot(queryClient, LIVE_QUERY_KEY_ROOTS.monthlyReports);
  invalidateRoot(queryClient, LIVE_QUERY_KEY_ROOTS.goalsReport);
}

export function invalidateRecurringQueries(queryClient: QueryClient): void {
  invalidateRoot(queryClient, LIVE_QUERY_KEY_ROOTS.rules);
  invalidateRoot(queryClient, LIVE_QUERY_KEY_ROOTS.billsOverview);
  invalidateRoot(queryClient, LIVE_QUERY_KEY_ROOTS.billDetail);
}

export function invalidateGoalQueries(queryClient: QueryClient): void {
  invalidateRoot(queryClient, LIVE_QUERY_KEY_ROOTS.buckets);
  invalidateRoot(queryClient, LIVE_QUERY_KEY_ROOTS.bucketDetail);
  invalidateRoot(queryClient, LIVE_QUERY_KEY_ROOTS.goalContributions);
  invalidateRoot(queryClient, LIVE_QUERY_KEY_ROOTS.bucketsSummary);
  invalidateRoot(queryClient, LIVE_QUERY_KEY_ROOTS.goalsReport);
}

export function invalidateSpendingLimitQueries(queryClient: QueryClient): void {
  invalidateRoot(queryClient, LIVE_QUERY_KEY_ROOTS.spendingTargets);
  invalidateRoot(queryClient, LIVE_QUERY_KEY_ROOTS.spendingTargetsSummary);
  invalidateRoot(queryClient, LIVE_QUERY_KEY_ROOTS.spendingTarget);
  invalidateRoot(queryClient, LIVE_QUERY_KEY_ROOTS.spendingTargetEdit);
}

export function invalidateReconcileQueries(queryClient: QueryClient): void {
  void queryClient.invalidateQueries({ queryKey: reconcileQueryKeys.all });
}

/** Prefixes removed on logout — all live financial / user-scoped server caches. */
export const FINANCIAL_QUERY_PREFIXES = [
  ["transactions"],
  ["timeline"],
  ["calendar-summary"],
  ["calendar-chunk"],
  ["accounts"],
  ["account"],
  ["dashboard-summary"],
  ["dashboard-summary-fast"],
  ["dashboard-summary-details"],
  ["extended-cash-risk"],
  ["recommendations"],
  ["resolve-risk"],
  ["debt-plan"],
  ["account-payoff"],
  ["rules"],
  ["bills-overview"],
  ["bill-detail"],
  ["spending-targets"],
  ["spending-targets-summary"],
  ["spending-target"],
  ["spending-target-edit"],
  ["spending-target-suggest-type"],
  ["buckets"],
  ["bucket-detail"],
  ["goal-contributions"],
  ["buckets-summary"],
  ["goals-report"],
  ["rule-allocations"],
  ["monthly-reports"],
  ["reconcile"],
  ["categories"],
] as const;

/**
 * Logout-only — clears all financial caches. Mutations must use domain helpers below.
 * @deprecated for mutation handlers — use targeted invalidation instead.
 */
export function invalidateFinancialQueries(queryClient: QueryClient): void {
  for (const queryKey of FINANCIAL_QUERY_PREFIXES) {
    void queryClient.invalidateQueries({ queryKey: [...queryKey] });
  }
}

/** Selective foreground refresh after long background — active screens only. */
export function refetchFinancialDataOnForeground(queryClient: QueryClient): void {
  const keys = [
    [LIVE_QUERY_KEY_ROOTS.dashboardSummaryFast],
    [LIVE_QUERY_KEY_ROOTS.dashboardSummaryDetails],
    [LIVE_QUERY_KEY_ROOTS.accounts],
    [LIVE_QUERY_KEY_ROOTS.transactions],
  ] as const;
  for (const queryKey of keys) {
    void queryClient.refetchQueries({ queryKey: [...queryKey], type: "active" });
  }
}

/**
 * Category-only transaction edits change classification, not balances or forecast math.
 */
export function refreshAfterTransactionCategoryEdit(queryClient: QueryClient): void {
  invalidateRoot(queryClient, LIVE_QUERY_KEY_ROOTS.transactions);
  invalidateSpendingLimitQueries(queryClient);
  invalidateDashboardQueries(queryClient);
  invalidateReportQueries(queryClient);
}

/** Transaction create / edit / delete — ledger, forecast, and derived views. */
export function refreshAfterTransactionEdit(
  queryClient: QueryClient,
  opts?: { categoryOnly?: boolean }
): void {
  if (opts?.categoryOnly) {
    refreshAfterTransactionCategoryEdit(queryClient);
    return;
  }
  invalidateLedgerQueries(queryClient);
  invalidateForecastQueries(queryClient);
  invalidateReportQueries(queryClient);
  invalidateSpendingLimitQueries(queryClient);
}

/**
 * Recurring-rule mutations affect forecasts; backend bumps household financial_revision.
 */
export function invalidateRecurringRuleDependents(queryClient: QueryClient): void {
  invalidateRecurringQueries(queryClient);
  invalidateRoot(queryClient, LIVE_QUERY_KEY_ROOTS.timeline);
  invalidateRoot(queryClient, LIVE_QUERY_KEY_ROOTS.calendarSummary);
  invalidateRoot(queryClient, LIVE_QUERY_KEY_ROOTS.calendarChunk);
  invalidateDashboardQueries(queryClient);
  invalidateRecommendationQueries(queryClient);
  invalidateRoot(queryClient, LIVE_QUERY_KEY_ROOTS.debtPlan);
  invalidateRoot(queryClient, LIVE_QUERY_KEY_ROOTS.accounts);
  invalidateRoot(queryClient, LIVE_QUERY_KEY_ROOTS.account);
  invalidateRoot(queryClient, LIVE_QUERY_KEY_ROOTS.buckets);
  invalidateRoot(queryClient, LIVE_QUERY_KEY_ROOTS.bucketDetail);
  invalidateRoot(queryClient, LIVE_QUERY_KEY_ROOTS.ruleAllocations);
  // What-If baseline uses live rules; keep scenario compare caches fresh after rule edits.
  invalidateRoot(queryClient, LIVE_QUERY_KEY_ROOTS.whatIfScenarios);
}

/** Spending-limit definition changes — budget summaries and limit performance only. */
export function invalidateSpendingTargetDependents(queryClient: QueryClient): void {
  invalidateSpendingLimitQueries(queryClient);
  invalidateDashboardQueries(queryClient);
  invalidateRecommendationQueries(queryClient);
  invalidateReportQueries(queryClient);
}

/** Display-name / institution edits — labels only, not forecast math. */
export function invalidateAfterAccountMetadataEdit(queryClient: QueryClient): void {
  invalidateAccountQueries(queryClient);
}

/** Create, archive, or financial field edits (type, limit, starting balance). */
export function invalidateAfterAccountFinancialMutation(queryClient: QueryClient): void {
  invalidateAccountQueries(queryClient);
  invalidateLedgerQueries(queryClient);
  invalidateForecastQueries(queryClient);
  invalidateRecommendationQueries(queryClient);
  invalidateReportQueries(queryClient);
}

/** Utilization target affects health metrics — not account picker metadata. */
export function invalidateAfterUtilizationTargetChange(queryClient: QueryClient): void {
  invalidateRoot(queryClient, LIVE_QUERY_KEY_ROOTS.accounts);
  invalidateRoot(queryClient, LIVE_QUERY_KEY_ROOTS.account);
  invalidateDashboardQueries(queryClient);
  invalidateRecommendationQueries(queryClient);
  invalidateRoot(queryClient, LIVE_QUERY_KEY_ROOTS.debtPlan);
  invalidateRoot(queryClient, LIVE_QUERY_KEY_ROOTS.extendedCashRisk);
}

/** Reconcile complete/undo — reconciled state and reports, not forecast rebuild. */
export function invalidateAfterReconcileMutation(queryClient: QueryClient): void {
  invalidateReconcileQueries(queryClient);
  invalidateRoot(queryClient, LIVE_QUERY_KEY_ROOTS.transactions);
  invalidateRoot(queryClient, LIVE_QUERY_KEY_ROOTS.account);
  invalidateReportQueries(queryClient);
}
