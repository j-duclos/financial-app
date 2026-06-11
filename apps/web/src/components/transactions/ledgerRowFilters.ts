import type { LedgerRow } from "./transactionsLedgerUtils";
import { resolveTransactionKind, type TransactionKind } from "./transactionKindUtils";

export const TRANSACTION_KIND_OPTIONS: TransactionKind[] = [
  "Expense",
  "Income",
  "Transfer",
  "Card Payment",
];

export type LedgerRowFilters = {
  kind: TransactionKind | "";
  amountMin: number | null;
  amountMax: number | null;
};

export function parseAmountFilterInput(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const n = parseFloat(trimmed.replace(/[$,]/g, ""));
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export function ledgerRowKind(row: LedgerRow): TransactionKind | null {
  if (row.type === "transaction") {
    return resolveTransactionKind({
      direction: row.txn.direction,
      category_name: row.txn.category?.name,
      description: row.txn.payee,
      linked_transaction_id: row.txn.linked_transaction_id,
      has_transfer_destination: Boolean(row.txn.transfer_to_account),
    });
  }
  if (row.type === "transaction_from_timeline") {
    return resolveTransactionKind({
      type: row.row.type,
      category_name: row.row.category_name,
      description: row.row.description,
    });
  }
  return null;
}

export function ledgerRowAbsAmount(row: LedgerRow): number | null {
  if (row.type === "transaction") {
    const n = parseFloat(row.txn.amount);
    return Number.isFinite(n) ? Math.abs(n) : null;
  }
  if (row.type === "transaction_from_timeline") {
    const n = parseFloat(row.row.amount);
    return Number.isFinite(n) ? Math.abs(n) : null;
  }
  return null;
}

export function matchesLedgerRowFilters(row: LedgerRow, filters: LedgerRowFilters): boolean {
  if (row.type !== "transaction" && row.type !== "transaction_from_timeline") {
    return true;
  }

  if (filters.kind) {
    const kind = ledgerRowKind(row);
    if (kind !== filters.kind) return false;
  }

  const abs = ledgerRowAbsAmount(row);
  if (abs == null) return false;

  if (filters.amountMin != null && abs < filters.amountMin) return false;
  if (filters.amountMax != null && abs > filters.amountMax) return false;

  return true;
}

export function filterLedgerPastRows(rows: LedgerRow[], filters: LedgerRowFilters): LedgerRow[] {
  if (!hasActiveLedgerRowFilters(filters)) return rows;
  return rows.filter((row) => matchesLedgerRowFilters(row, filters));
}

export function hasActiveLedgerRowFilters(filters: LedgerRowFilters): boolean {
  return Boolean(filters.kind) || filters.amountMin != null || filters.amountMax != null;
}
