import type { Transaction, TimelineRow } from "@budget-app/shared";
import { isImportMatchStatusMatched } from "@budget-app/shared";
import type { FinancialTone } from "@/theme";

export type TransactionStatusIcon = "reconciled" | "manual" | "rule" | "plaid" | "transfer" | "forecast";

export function isBankImportedTransaction(txn: {
  plaid_transaction_id?: string | null;
  source?: string | null;
}): boolean {
  if ((txn.plaid_transaction_id ?? "").trim()) return true;
  return (txn.source ?? "").toUpperCase() === "PLAID";
}

/** Manual / scheduled rows may be deleted; bank imports and reconciled rows may not. */
export function canDeleteTransaction(txn: {
  reconciled?: boolean;
  plaid_transaction_id?: string | null;
  source?: string | null;
}): boolean {
  if (txn.reconciled) return false;
  if (isBankImportedTransaction(txn)) return false;
  return true;
}

/**
 * Category is metadata — allowed on imports. Reconciled rows lock category
 * (appears on reconciliation history).
 */
export function canChangeTransactionCategory(txn: { reconciled?: boolean }): boolean {
  return !txn.reconciled;
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
    return "Reconciled transaction. Financial fields are locked.";
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
  plaid: "Bank transaction",
  transfer: "Transfer",
  forecast: "Forecast",
};

export type TransactionDetailBadge = {
  key: string;
  label: string;
  tone: FinancialTone;
};

/**
 * Compact detail chips. Origin belongs on the Source row — do not also chip
 * Imported / Scheduled / Manual. Pending here means bank settlement only.
 */
export function resolveTransactionDetailBadges(
  txn: Transaction,
  today: string
): TransactionDetailBadge[] {
  const badges: TransactionDetailBadge[] = [];
  const status = (txn.status ?? "").toUpperCase();
  const isPlanned = status === "PLANNED";
  const isBank = isBankImportedTransaction(txn);
  const matched = isImportMatchStatusMatched(txn.import_match_status);
  const isFutureDate = txn.date > today;
  const src = (txn.source ?? "").toUpperCase();

  if (isTransferTransaction(txn)) {
    badges.push({ key: "transfer", label: "Transfer", tone: "neutral" });
  }

  if (matched) {
    badges.push({ key: "matched", label: "Matched", tone: "positive" });
  }

  if (isPlanned) {
    if (isFutureDate) {
      if (src === "RULE" || txn.rule_id != null) {
        badges.push({ key: "forecast", label: "Forecast", tone: "neutral" });
      } else {
        badges.push({ key: "future", label: "Future", tone: "neutral" });
      }
    }
  } else if (isBank) {
    if (txn.cleared) {
      badges.push({ key: "cleared", label: "Cleared", tone: "positive" });
    } else {
      badges.push({ key: "pending", label: "Pending", tone: "warning" });
    }
  }

  if (txn.reconciled) {
    badges.push({ key: "reconciled", label: "Reconciled", tone: "neutral" });
  }

  return badges;
}
