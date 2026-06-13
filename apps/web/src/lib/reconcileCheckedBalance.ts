import type { ReconcileTransactionRow } from "@budget-app/shared";

/** Balance after the last checked row — matches the running Balance column. */
export function reconcileBalanceAfterChecks(
  transactions: ReconcileTransactionRow[],
  checkedIds: Set<number>,
  periodOpeningBalance: number
): number {
  if (checkedIds.size === 0) return periodOpeningBalance;

  const sortedChecked = transactions
    .filter((t) => checkedIds.has(t.id))
    .sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id);

  if (sortedChecked.length === 0) return periodOpeningBalance;

  // Use opening + sum of checked rows only. Running balances from the API walk every
  // unreconciled row in the period, so they include unchecked siblings and block partial reconcile.
  let sum = 0;
  for (const t of sortedChecked) {
    const amt = parseFloat(t.amount);
    if (Number.isFinite(amt)) sum += amt;
  }
  return periodOpeningBalance + sum;
}
