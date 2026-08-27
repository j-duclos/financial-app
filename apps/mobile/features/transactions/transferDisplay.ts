import type { TimelineRow, Transaction } from "@budget-app/shared";
import { getEffectiveDisplayName } from "@budget-app/shared";
import { isTransferTransaction } from "@/lib/transactionStatus";

function counterpartyName(txn: Transaction): string | null {
  const counterparty = txn.transfer_to_account;
  if (counterparty) return getEffectiveDisplayName(counterparty);
  return null;
}

/** Account-specific transfer subtitle for ledger rows (e.g. "Transfer to Savings"). */
export function transactionTransferSubtitle(txn: Transaction): string | null {
  if (!isTransferTransaction(txn)) return null;
  const name = counterpartyName(txn);
  if (!name) return "Transfer";
  return txn.direction === "INFLOW" ? `Transfer from ${name}` : `Transfer to ${name}`;
}

export function timelineTransferSubtitle(row: TimelineRow): string | null {
  const type = row.type?.toLowerCase() ?? "";
  const category = row.category_name?.toLowerCase() ?? "";
  const isTransfer =
    type.includes("transfer") ||
    category === "transfer" ||
    category === "bank transfer" ||
    category === "credit card payment";
  if (!isTransfer) return null;
  return category ? row.category_name : "Transfer";
}
