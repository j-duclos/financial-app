import type { QueryClient } from "@tanstack/react-query";
import {
  invalidateDashboardQueries,
  invalidateForecastQueries,
  invalidateLedgerQueries,
  invalidateReportQueries,
} from "@/lib/financialQueryRefresh";

export const goalsQueryKeys = {
  overview: (householdId: number | null | undefined) =>
    ["buckets", "overview", householdId] as const,
  detail: (goalId: number, scenarioId?: number | "") =>
    ["bucket-detail", goalId, scenarioId ?? ""] as const,
  contributions: (goalId: number, page?: number) =>
    ["goal-contributions", goalId, page ?? 1] as const,
  formAccounts: () => ["accounts", "goals-form"] as const,
  formAllocation: (goalId: number) => ["rule-allocations", goalId] as const,
};

/** Recent contribution preview size on Goal Detail. */
export const GOAL_DETAIL_HISTORY_PREVIEW_LIMIT = 5;

function invalidateGoalRoots(queryClient: QueryClient): void {
  void queryClient.invalidateQueries({ queryKey: ["buckets"] });
  void queryClient.invalidateQueries({ queryKey: ["bucket-detail"] });
  void queryClient.invalidateQueries({ queryKey: ["goal-contributions"] });
  void queryClient.invalidateQueries({ queryKey: ["buckets-summary"] });
  void queryClient.invalidateQueries({ queryKey: ["goals-report"] });
}

/** Name, notes, target date/amount, priority — not forecast plumbing. */
export function invalidateGoalMetadataQueries(queryClient: QueryClient): void {
  invalidateGoalRoots(queryClient);
  invalidateDashboardQueries(queryClient);
}

/** Real contribution / withdrawal — may touch ledger and reports. */
export function invalidateGoalContributionQueries(queryClient: QueryClient): void {
  invalidateGoalRoots(queryClient);
  invalidateDashboardQueries(queryClient);
  invalidateReportQueries(queryClient);
  invalidateLedgerQueries(queryClient);
  invalidateForecastQueries(queryClient);
}

/** Funding rule / allocation / planned contribution changes. */
export function invalidateGoalFundingQueries(queryClient: QueryClient): void {
  invalidateGoalMetadataQueries(queryClient);
  invalidateForecastQueries(queryClient);
  invalidateLedgerQueries(queryClient);
  void queryClient.invalidateQueries({ queryKey: ["rule-allocations"] });
  void queryClient.invalidateQueries({ queryKey: ["rules"] });
}

/** Lifecycle (pause, complete, archive) — status affects safe-to-spend forecast. */
export function invalidateGoalLifecycleQueries(queryClient: QueryClient): void {
  invalidateGoalMetadataQueries(queryClient);
  invalidateForecastQueries(queryClient);
}

/** @deprecated Prefer specific goal invalidation helpers. */
export function invalidateGoalsQueries(queryClient: QueryClient): void {
  invalidateGoalFundingQueries(queryClient);
}
