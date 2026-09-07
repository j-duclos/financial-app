import type { Transaction } from "@budget-app/shared";
import {
  isImportMatchStatusMatched,
  MATCH_BANK_TRANSACTION_LABEL,
} from "@budget-app/shared";
import type { Href } from "expo-router";
import {
  canDeleteTransaction,
  isBankImportedTransaction,
  isTransferTransaction,
} from "@/lib/transactionStatus";
import { isPlannedScheduledTransaction } from "./pendingSemantics";
import { transactionRowDetailPath } from "./transactionRowNavigation";

export type TransactionDetailActionKind = "edit" | "skip" | "matchImport" | "delete";

export type TransactionDetailActionPlacement =
  | "primary"
  | "secondary"
  | "overflow"
  | "destructive";

export type TransactionDetailAction = {
  kind: TransactionDetailActionKind;
  label: string;
  placement: TransactionDetailActionPlacement;
  confirmationTitle?: string;
  confirmationMessage?: string;
  destructive?: boolean;
};

export type TransactionDetailActionsInput = {
  txn: Transaction;
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

/** Planned rows that can be linked to an unmatched bank import via the match API. */
export function isEligibleForImportMatch(txn: Transaction): boolean {
  return isPlannedScheduledTransaction(txn);
}

export function isAlreadyMatchedToImport(txn: Transaction): boolean {
  return isImportMatchStatusMatched(txn.import_match_status);
}

/**
 * Canonical Transaction Detail actions — source/status aware.
 *
 * Future scheduled: Edit (primary) + Skip (secondary) + Match bank (overflow).
 * Posted manual: Edit when permitted + Delete when allowed.
 * Bank imports / reconciled: no financial edit/delete.
 */
export function getTransactionDetailActions(
  input: TransactionDetailActionsInput
): TransactionDetailAction[] {
  const { txn } = input;
  const actions: TransactionDetailAction[] = [];
  const isPlanned = isPlannedScheduledTransaction(txn);
  const isTransfer = isTransferTransaction(txn);
  const alreadyMatched = isAlreadyMatchedToImport(txn);
  const canEdit = !txn.reconciled && !isBankImportedTransaction(txn);

  if (canEdit) {
    actions.push({
      kind: "edit",
      label: isPlanned ? "Edit this occurrence" : "Edit",
      placement: "primary",
    });
  }

  if (isPlanned && !alreadyMatched) {
    actions.push({
      kind: "skip",
      label: "Skip occurrence",
      placement: "secondary",
      confirmationTitle: "Skip this occurrence?",
      confirmationMessage: skipConfirmationMessage(txn),
    });
    if (isEligibleForImportMatch(txn)) {
      actions.push({
        kind: "matchImport",
        label: MATCH_BANK_TRANSACTION_LABEL,
        placement: "overflow",
      });
    }
  }

  if (canDeleteTransaction(txn) && !isPlanned && !alreadyMatched) {
    actions.push({
      kind: "delete",
      label: "Delete transaction",
      placement: "destructive",
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

export function recurringRuleDetailPath(ruleId: number): Href {
  return `/recurring/${ruleId}` as Href;
}

export function canOpenLinkedTransactionDetail(txn: Transaction): boolean {
  const linkedId = txn.linked_transaction_id;
  return linkedId != null && Number.isInteger(linkedId) && linkedId > 0;
}

export function linkedTransactionDetailPath(linkedTransactionId: number): Href {
  return transactionRowDetailPath(linkedTransactionId);
}
