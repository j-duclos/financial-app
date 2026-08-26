import type { Transaction, TimelineRow } from "@budget-app/shared";

export type TransactionStatusIcon = "reconciled" | "manual" | "rule" | "plaid" | "transfer" | "forecast";

export function isBankImportedTransaction(txn: {
  plaid_transaction_id?: string | null;
  source?: string | null;
}): boolean {
  if ((txn.plaid_transaction_id ?? "").trim()) return true;
  return (txn.source ?? "").toUpperCase() === "PLAID";
}

export function isTransferTransaction(txn: Transaction): boolean {
  if (txn.transfer_to_account != null || txn.linked_transaction_id != null) return true;
  const cat = txn.category?.name ?? "";
  return cat === "Transfer" || cat === "Bank Transfer" || cat === "Credit Card Payment";
}

export function transactionEditLockMessage(
  txn: {
    reconciled?: boolean;
    plaid_transaction_id?: string | null;
    source?: string | null;
  },
  accountName?: string | null
): string | null {
  if (txn.reconciled) {
    return "Reconciled transaction. Financial fields are locked. Undo the reconciliation to change accounting history.";
  }
  if (isBankImportedTransaction(txn)) {
    const from = accountName?.trim()
      ? `Imported from ${accountName.trim()}`
      : "Imported from your bank";
    return `${from}. Amount and posted date are controlled by your bank.`;
  }
  return null;
}

export function resolveTransactionStatusIcons(
  txn: Transaction,
  timelineRow?: TimelineRow | null
): TransactionStatusIcon[] {
  const icons: TransactionStatusIcon[] = [];
  if (txn.reconciled) icons.push("reconciled");

  const txnSrc = (txn.source ?? "").toLowerCase();
  const ledgerSrc = (timelineRow?.source ?? "").toLowerCase();
  const importMatched = (txn.import_match_status ?? "").toLowerCase() === "matched";
  const fromPlaid = Boolean((txn.plaid_transaction_id ?? "").trim());

  if (txnSrc === "plaid" || importMatched || fromPlaid) {
    icons.push("plaid");
  } else if (txn.rule_id != null || txnSrc === "rule" || txnSrc === "one_time" || ledgerSrc === "rule") {
    icons.push("rule");
  } else if (isTransferTransaction(txn)) {
    icons.push("transfer");
  } else if (txnSrc === "actual" || ledgerSrc === "actual" || !txnSrc) {
    icons.push("manual");
  }

  const status = (txn.status ?? timelineRow?.status ?? "").toUpperCase();
  if (status === "PLANNED" || (timelineRow && !timelineRow.transaction_id && timelineRow.source === "rule")) {
    if (!icons.includes("forecast")) icons.push("forecast");
  }

  return icons;
}

export const STATUS_ICON_LABELS: Record<TransactionStatusIcon, string> = {
  reconciled: "Reconciled",
  manual: "Manual",
  rule: "Scheduled",
  plaid: "Imported",
  transfer: "Transfer",
  forecast: "Forecast",
};
