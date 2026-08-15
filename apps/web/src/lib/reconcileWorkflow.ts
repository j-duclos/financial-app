import { formatCurrency } from "@budget-app/shared";
import { centsToAmount } from "./moneyCents";

export const RECONCILE_BALANCE_TOLERANCE_CENTS = 1;

export function completeDisabledReason(opts: {
  hasBankBalance: boolean;
  differenceCents: number | null;
}): string | null {
  if (!opts.hasBankBalance || opts.differenceCents == null) {
    return "Enter bank balance to begin.";
  }
  if (Math.abs(opts.differenceCents) > RECONCILE_BALANCE_TOLERANCE_CENTS) {
    return "Difference must be $0.00 before reconciliation can be completed.";
  }
  return null;
}

export function selectedCountLabel(selected: number, total: number): string {
  return `${selected} of ${total} transaction${total === 1 ? "" : "s"} selected`;
}

export function formatSignedCurrency(cents: number, currency = "USD"): string {
  const amount = centsToAmount(cents);
  const formatted = formatCurrency(Math.abs(amount), currency);
  if (amount > 0) return `+${formatted}`;
  if (amount < 0) return `-${formatted}`;
  return formatted;
}

export function isReconcileBalanced(differenceCents: number | null): boolean {
  return differenceCents != null && Math.abs(differenceCents) <= RECONCILE_BALANCE_TOLERANCE_CENTS;
}
