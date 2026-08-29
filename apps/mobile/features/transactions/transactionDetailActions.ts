import type { Transaction } from "@budget-app/shared";
import {
  canDeleteTransaction,
  isBankImportedTransaction,
  isTransferTransaction,
} from "@/lib/transactionStatus";
import { isPlannedScheduledTransaction } from "./pendingSemantics";
import { prefersDirectEditFromLedger } from "./transactionRowNavigation";

export type TransactionDetailActionKind = "edit" | "skip" | "matchedImport" | "delete";

export type TransactionDetailAction = {
  kind: TransactionDetailActionKind;
  label: string;
  confirmationTitle?: string;
  confirmationMessage?: string;
  destructive?: boolean;
};

export type TransactionDetailActionsInput = {
  txn: Transaction;
  /** When true, a matching Plaid import exists for this planned row. */
  hasMatchingImport?: boolean;
};

function isRuleGeneratedOccurrence(txn: Transaction): boolean {
  const src = (txn.source ?? "").toUpperCase();
  return src === "RULE" || txn.rule_id != null;
}

function skipConfirmationMessage(txn: Transaction): string {
  if (isRuleGeneratedOccurrence(txn)) {
    return (
      "This scheduled payment will be removed from the forecast. " +
      "Future occurrences of the recurring rule will continue."
    );
  }
  return "This scheduled payment will be removed from the forecast.";
}

/**
 * Canonical Transaction Detail actions — source/status aware.
 *
 * Planned rule/one-time occurrences: Edit + Skip only (Delete is redundant with Skip).
 * Posted manual rows: Edit + Delete when allowed. Bank imports: no destructive actions.
 */
export function getTransactionDetailActions(
  input: TransactionDetailActionsInput
): TransactionDetailAction[] {
  const { txn, hasMatchingImport = false } = input;
  const actions: TransactionDetailAction[] = [];
  const isPlanned = isPlannedScheduledTransaction(txn);
  const isTransfer = isTransferTransaction(txn);
  const canEdit = !txn.reconciled && !isBankImportedTransaction(txn);

  if (canEdit && !prefersDirectEditFromLedger(txn)) {
    actions.push({
      kind: "edit",
      label: isPlanned ? "Edit this occurrence" : "Edit",
    });
  }

  if (isPlanned && hasMatchingImport) {
    actions.push({ kind: "matchedImport", label: "Matched Import" });
  } else if (isPlanned) {
    actions.push({
      kind: "skip",
      label: "Skip occurrence",
      confirmationTitle: "Skip this occurrence?",
      confirmationMessage: skipConfirmationMessage(txn),
    });
  }

  if (canDeleteTransaction(txn) && !isPlanned && !prefersDirectEditFromLedger(txn)) {
    actions.push({
      kind: "delete",
      label: "Delete transaction",
      destructive: true,
      confirmationTitle: "Delete transaction",
      confirmationMessage: isTransfer
        ? "This may delete or unlink both sides of the transfer, depending on account settings."
        : "This transaction will be permanently removed.",
    });
  }

  return actions;
}

export function canOpenRecurringRuleDetail(txn: Transaction): boolean {
  return txn.rule_id != null && Number.isInteger(txn.rule_id) && txn.rule_id > 0;
}

export function recurringRuleDetailPath(ruleId: number): string {
  return `/recurring/${ruleId}`;
}
