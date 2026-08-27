export * from "@budget-app/shared/upcomingDisplay";

import type { DashboardUpcomingTransaction } from "@budget-app/shared";
import { severityTokens } from "./severity";

export function upcomingPreviewAmountClass(
  amount: number,
  txn: DashboardUpcomingTransaction
): string {
  const isCardPayment = txn.is_credit_card_payment;
  const isTransfer = !isCardPayment && (txn.is_transfer || txn.is_internal_transfer);
  if (isTransfer) return "text-gray-900";
  if (amount > 0) return "text-green-600";
  if (amount < 0) return "text-red-600";
  return "text-gray-900";
}

export function upcomingPreviewBalanceClass(
  balance: number,
  isFirstZeroCross: boolean
): string {
  if (isFirstZeroCross) return severityTokens("critical").endingClass;
  if (balance < 0) return "text-red-700 font-semibold tabular-nums";
  return "text-gray-900 tabular-nums";
}

export function upcomingPreviewRowClass(isFirstZeroCross: boolean): string {
  return isFirstZeroCross
    ? `${severityTokens("critical").rowTintClass} border-l-2 border-l-red-600 pl-1.5 -ml-1.5`
    : "";
}
