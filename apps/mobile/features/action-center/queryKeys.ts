import type { QueryClient } from "@tanstack/react-query";

export const actionCenterQueryKeys = {
  recommendations: (forecastDays: number) => ["recommendations", "action-center", forecastDays] as const,
  resolveRisk: (accountId: number, forecastDays: number) =>
    ["resolve-risk", accountId, forecastDays] as const,
};

/** Snooze/dismiss/restore — presentation state only, not financial mutations. */
export function invalidateActionCenterRecommendationQueries(queryClient: QueryClient): void {
  void queryClient.invalidateQueries({ queryKey: ["recommendations"] });
}

/** After an applied transfer or other financial mutation from Resolve Risk. */
export function invalidateActionCenterFinancialQueries(queryClient: QueryClient): void {
  void queryClient.invalidateQueries({ queryKey: ["recommendations"] });
  void queryClient.invalidateQueries({ queryKey: ["dashboard-summary"] });
  void queryClient.invalidateQueries({ queryKey: ["dashboard-summary-fast"] });
  void queryClient.invalidateQueries({ queryKey: ["dashboard-summary-details"] });
  void queryClient.invalidateQueries({ queryKey: ["extended-cash-risk"] });
}

/** @deprecated Use invalidateActionCenterRecommendationQueries or invalidateActionCenterFinancialQueries */
export function invalidateActionCenterQueries(queryClient: QueryClient): void {
  invalidateActionCenterFinancialQueries(queryClient);
}
