import type { QueryClient } from "@tanstack/react-query";
import { invalidateFinancialQueries } from "@/lib/financialQueryRefresh";

export const reconcileQueryKeys = {
  all: ["reconcile"] as const,
  setup: (accountId: number | null | undefined, start?: string | null, end?: string | null) =>
    ["reconcile", "setup", accountId ?? null, start ?? null, end ?? null] as const,
  meta: (accountId: number | null | undefined) =>
    ["reconcile", "meta", accountId ?? null] as const,
  sessions: (accountId: number | null | undefined) =>
    ["reconcile", "sessions", accountId ?? null] as const,
  sessionDetail: (sessionId: number) => ["reconcile", "session", sessionId] as const,
  preview: (
    accountId: number | null | undefined,
    periodStart: string,
    periodEnd: string,
    bankBalance: string,
    checkedKey: string
  ) =>
    [
      "reconcile",
      "preview",
      accountId ?? null,
      periodStart,
      periodEnd,
      bankBalance,
      checkedKey,
    ] as const,
};

/** After complete/undo — refresh ledger + reconcile caches. Does not fetch forecast during browse. */
export function invalidateAfterReconcileMutation(queryClient: QueryClient): void {
  void queryClient.invalidateQueries({ queryKey: reconcileQueryKeys.all });
  void queryClient.invalidateQueries({ queryKey: ["reconcile-setup"] });
  invalidateFinancialQueries(queryClient);
}
