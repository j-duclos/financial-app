/** Canonical React Query keys for lightweight picker/reference data. */
export const referenceQueryKeys = {
  accountOptions: (householdId: number | null | undefined) =>
    ["account-options", householdId ?? null] as const,
  categoryOptions: (householdId: number | null | undefined) =>
    ["category-options", householdId ?? null] as const,
};

/** Account metadata for pickers — changes less often than balances. */
export const ACCOUNT_OPTIONS_STALE_MS = 5 * 60_000;

/** Category lists — changes less often than transactions. */
export const CATEGORY_OPTIONS_STALE_MS = 10 * 60_000;

export function invalidateAccountOptionsQueries(
  queryClient: import("@tanstack/react-query").QueryClient
): void {
  void queryClient.invalidateQueries({ queryKey: ["account-options"] });
}

export function invalidateCategoryOptionsQueries(
  queryClient: import("@tanstack/react-query").QueryClient
): void {
  void queryClient.invalidateQueries({ queryKey: ["category-options"] });
}
