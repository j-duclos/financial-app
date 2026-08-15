export type HouseholdAccount = {
  id: number;
  household: { id: number } | number;
};

export function accountHouseholdId(account: HouseholdAccount): number | null {
  const h = account.household;
  if (h == null) return null;
  if (typeof h === "number") return h;
  return typeof h.id === "number" ? h.id : null;
}

export function accountsForHousehold<T extends HouseholdAccount>(
  accounts: T[],
  householdId: number | "" | null
): T[] {
  if (householdId === "" || householdId == null) return [];
  return accounts.filter((a) => accountHouseholdId(a) === householdId);
}

/** When household changes, keep the account only if it still belongs. */
export function nextDefaultAccountId(
  currentAccountId: number | "",
  householdId: number | "",
  accounts: HouseholdAccount[]
): number | "" {
  if (householdId === "" || currentAccountId === "") return "";
  if (accounts.length === 0) return currentAccountId;
  const stillValid = accountsForHousehold(accounts, householdId).some(
    (a) => a.id === currentAccountId
  );
  return stillValid ? currentAccountId : "";
}
