import type { Account } from "@budget-app/shared";

/**
 * Household for API calls when an account filter may override the profile default.
 */
export function resolveHouseholdId(
  defaultHouseholdId: number | null | undefined,
  accountId: number | null | undefined,
  accounts: Account[]
): number | null {
  if (accountId != null) {
    const account = accounts.find((a) => a.id === accountId);
    if (account?.household?.id != null) return account.household.id;
  }
  return defaultHouseholdId ?? null;
}
