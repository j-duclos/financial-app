import type { QueryClient } from "@tanstack/react-query";

export const actionCenterQueryKeys = {
  recommendations: (forecastDays: number) => ["recommendations", "action-center", forecastDays] as const,
  resolveRisk: (accountId: number, forecastDays: number) =>
    ["resolve-risk", accountId, forecastDays] as const,
};

export function invalidateActionCenterQueries(queryClient: QueryClient): void {
  void queryClient.invalidateQueries({ queryKey: ["recommendations"] });
  void queryClient.invalidateQueries({ queryKey: ["dashboard-summary"] });
  void queryClient.invalidateQueries({ queryKey: ["dashboard-summary-fast"] });
  void queryClient.invalidateQueries({ queryKey: ["dashboard-summary-details"] });
  void queryClient.invalidateQueries({ queryKey: ["extended-cash-risk"] });
}
