import type { Transaction, TimelineRow } from "@budget-app/shared";
import {
  isBankImportedTransaction,
  isTransferTransaction,
} from "@/lib/transactionStatus";
import type { TransactionListRow } from "./buildTransactionList";
import { isPlannedScheduledTransaction } from "./pendingSemantics";

export type TransactionRowDestination =
  | { type: "edit"; transactionId: number }
  | { type: "detail"; transactionId: number };

export function transactionRowEditPath(transactionId: number): string {
  return `/transaction/edit/${transactionId}`;
}

export function transactionRowDetailPath(transactionId: number): string {
  return `/transaction/${transactionId}`;
}

export function isRuleGeneratedTransaction(txn: Transaction): boolean {
  const src = (txn.source ?? "").toUpperCase();
  return src === "RULE" || txn.rule_id != null;
}

export function isRuleGeneratedTimelineRow(row: TimelineRow): boolean {
  if (row.source === "rule") return true;
  if ((row.txn_source ?? "").toUpperCase() === "RULE") return true;
  return row.rule_id != null;
}

function isBankImportedTimelineRow(row: TimelineRow): boolean {
  if ((row.plaid_transaction_id ?? "").trim()) return true;
  const src = (row.txn_source ?? row.source ?? "").toUpperCase();
  return src === "PLAID";
}

function isTransferTimelineRow(row: TimelineRow): boolean {
  const cat = (row.category_name ?? "").trim();
  if (cat === "Bank Transfer" || cat === "Credit Card Payment" || cat === "Transfer") {
    return true;
  }
  return (row.type ?? "").toLowerCase().includes("transfer");
}

/**
 * Manual editable rows open Edit directly from the Transactions ledger (web parity).
 * Rule/import/reconciled/transfer rows open Detail for context-first flows.
 */
export function prefersDirectEditFromLedger(txn: Transaction): boolean {
  if (txn.reconciled) return false;
  if (isBankImportedTransaction(txn)) return false;
  if ((txn.import_match_status ?? "").toLowerCase() === "matched") return false;
  if (isRuleGeneratedTransaction(txn)) return false;
  if (isTransferTransaction(txn)) return false;

  const src = (txn.source ?? "").toUpperCase();
  if (src === "INTEREST") return false;

  if (isPlannedScheduledTransaction(txn)) {
    return src === "ONE_TIME";
  }

  return true;
}

export function prefersDirectEditFromLedgerTimelineRow(row: TimelineRow): boolean {
  if (row.reconciled) return false;
  if (row.source === "interest") return false;
  if (isBankImportedTimelineRow(row)) return false;
  if ((row.import_match_status ?? "").toLowerCase() === "matched") return false;
  if (isRuleGeneratedTimelineRow(row)) return false;
  if (isTransferTimelineRow(row)) return false;

  const status = (row.status ?? "").toUpperCase();
  if (status === "PLANNED") {
    const txnSrc = (row.txn_source ?? "").toUpperCase();
    if (txnSrc === "ONE_TIME") return true;
    if (isRuleGeneratedTimelineRow(row)) return false;
    return txnSrc === "ACTUAL" || txnSrc === "";
  }

  return true;
}

export function getTransactionRowDestinationFromTransaction(
  txn: Transaction
): TransactionRowDestination {
  const transactionId = txn.id;
  if (prefersDirectEditFromLedger(txn)) {
    return { type: "edit", transactionId };
  }
  return { type: "detail", transactionId };
}

export function getTransactionRowDestinationFromTimelineRow(
  row: TimelineRow
): TransactionRowDestination | null {
  const transactionId = row.transaction_id;
  if (transactionId == null) return null;
  if (prefersDirectEditFromLedgerTimelineRow(row)) {
    return { type: "edit", transactionId };
  }
  return { type: "detail", transactionId };
}

export function getTransactionRowDestination(
  item: TransactionListRow
): TransactionRowDestination | null {
  if (item.kind === "history") {
    return getTransactionRowDestinationFromTransaction(item.txn);
  }
  if (item.kind === "pending" || item.kind === "upcoming") {
    return getTransactionRowDestinationFromTimelineRow(item.row);
  }
  return null;
}

export function navigateToTransactionRowDestination(
  router: { push: (path: string) => void },
  destination: TransactionRowDestination
): void {
  router.push(
    destination.type === "edit"
      ? transactionRowEditPath(destination.transactionId)
      : transactionRowDetailPath(destination.transactionId)
  );
}
