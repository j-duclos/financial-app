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

/** Use a listed household only when there is exactly one. Never pick among multiple. */
export function singleHouseholdIdIfUnambiguous(
  households: Array<{ id: number }> | undefined | null
): number | null {
  if (households?.length !== 1) return null;
  return households[0]?.id ?? null;
}
