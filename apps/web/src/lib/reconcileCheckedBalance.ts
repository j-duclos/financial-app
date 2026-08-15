import type { ReconcileTransactionRow } from "@budget-app/shared";
import { centsToAmount, parseMoneyToCents } from "./moneyCents";

/** Balance after the last checked row — matches the running Balance column. */
export function reconcileBalanceAfterChecks(
  transactions: ReconcileTransactionRow[],
  checkedIds: Set<number>,
  periodOpeningBalance: number
): number {
  return centsToAmount(
    reconcileBalanceAfterChecksCents(transactions, checkedIds, parseMoneyToCents(periodOpeningBalance))
  );
}

export function reconcileBalanceAfterChecksCents(
  transactions: ReconcileTransactionRow[],
  checkedIds: Set<number>,
  periodOpeningCents: number
): number {
  if (checkedIds.size === 0) return periodOpeningCents;

  const sortedChecked = transactions
    .filter((t) => checkedIds.has(t.id))
    .sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id);

  if (sortedChecked.length === 0) return periodOpeningCents;

  let sum = 0;
  for (const t of sortedChecked) {
    sum += parseMoneyToCents(t.amount);
  }
  return periodOpeningCents + sum;
}

export function selectedActivityCents(
  transactions: ReconcileTransactionRow[],
  checkedIds: Set<number>
): number {
  let sum = 0;
  for (const t of transactions) {
    if (checkedIds.has(t.id)) sum += parseMoneyToCents(t.amount);
  }
  return sum;
}
