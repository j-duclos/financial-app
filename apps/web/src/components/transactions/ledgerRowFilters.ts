import type { LedgerRow } from "./transactionsLedgerUtils";

export type LedgerRowFilters = {
  amountMin: number | null;
  amountMax: number | null;
};

export function parseAmountFilterInput(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const n = parseFloat(trimmed.replace(/[$,]/g, ""));
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export function ledgerRowAbsAmount(row: LedgerRow): number | null {
  if (row.type === "transaction") {
    const n = parseFloat(row.txn.amount);
    return Number.isFinite(n) ? Math.abs(n) : null;
  }
  if (row.type === "transaction_from_timeline" || row.type === "recurring") {
    const n = parseFloat(row.row.amount);
    return Number.isFinite(n) ? Math.abs(n) : null;
  }
  return null;
}

export function matchesLedgerRowFilters(row: LedgerRow, filters: LedgerRowFilters): boolean {
  if (
    row.type !== "transaction" &&
    row.type !== "transaction_from_timeline" &&
    row.type !== "recurring"
  ) {
    return true;
  }

  if (filters.amountMin != null || filters.amountMax != null) {
    const abs = ledgerRowAbsAmount(row);
    if (abs == null) return false;
    if (filters.amountMin != null && abs < filters.amountMin) return false;
    if (filters.amountMax != null && abs > filters.amountMax) return false;
  }

  return true;
}

export function filterLedgerPastRows(rows: LedgerRow[], filters: LedgerRowFilters): LedgerRow[] {
  if (!hasActiveLedgerRowFilters(filters)) return rows;
  return rows.filter((row) => matchesLedgerRowFilters(row, filters));
}

/** Display-only filter for Recent / Pending / Upcoming — does not recompute running balances. */
export const filterLedgerRows = filterLedgerPastRows;

export function hasActiveLedgerRowFilters(filters: LedgerRowFilters): boolean {
  return filters.amountMin != null || filters.amountMax != null;
}
