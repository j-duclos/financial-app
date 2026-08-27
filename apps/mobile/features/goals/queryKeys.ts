import type { QueryClient } from "@tanstack/react-query";

export const goalsQueryKeys = {
  overview: (householdId: number | null | undefined) =>
    ["buckets", "overview", householdId] as const,
  detail: (goalId: number, scenarioId?: number | "") =>
    ["bucket-detail", goalId, scenarioId ?? ""] as const,
  formAccounts: () => ["accounts", "goals-form"] as const,
  formRules: () => ["recurring-rules", "goals-funding"] as const,
  formAllocation: (goalId: number) => ["rule-allocations", goalId] as const,
};

export function invalidateGoalsQueries(queryClient: QueryClient): void {
  void queryClient.invalidateQueries({ queryKey: ["buckets"] });
  void queryClient.invalidateQueries({ queryKey: ["buckets-summary"] });
  void queryClient.invalidateQueries({ queryKey: ["dashboard-summary-fast"] });
  void queryClient.invalidateQueries({ queryKey: ["dashboard-summary-details"] });
  void queryClient.invalidateQueries({ queryKey: ["dashboard-summary"] });
  void queryClient.invalidateQueries({ queryKey: ["goals-report"] });
  void queryClient.invalidateQueries({ queryKey: ["recurring-rules"] });
  void queryClient.invalidateQueries({ queryKey: ["rule-allocations"] });
  void queryClient.invalidateQueries({ queryKey: ["accounts"] });
}
