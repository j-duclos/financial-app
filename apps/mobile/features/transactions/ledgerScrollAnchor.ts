import type { TransactionListRow } from "./buildTransactionList";

/** How many posted Recent rows to keep visible above Pending/Upcoming on open. */
export const LEDGER_ANCHOR_PAST_ROWS = 4;

/** Approximate heights for getItemLayout / initialScrollIndex (variable UI → close enough). */
export const LEDGER_SECTION_HEIGHT = 48;
export const LEDGER_ROW_HEIGHT = 76;
export const LEDGER_SKELETON_HEIGHT = 56;

/**
 * Index of the ledger "today" boundary: Pending section, else Upcoming section.
 * Returns null when the list has no boundary to anchor (Recent-only / empty).
 */
export function findLedgerBoundaryIndex(rows: TransactionListRow[]): number | null {
  const pending = rows.findIndex(
    (row) => row.kind === "section" && row.id === "section-pending"
  );
  if (pending >= 0) return pending;

  const upcoming = rows.findIndex(
    (row) => row.kind === "section" && row.id === "section-upcoming"
  );
  if (upcoming >= 0) return upcoming;

  return null;
}

/**
 * FlatList index to place at the top of the viewport so ~LEDGER_ANCHOR_PAST_ROWS
 * history rows sit above the Pending/Upcoming boundary.
 */
export function ledgerAnchorScrollIndex(rows: TransactionListRow[]): number | null {
  const boundary = findLedgerBoundaryIndex(rows);
  if (boundary == null) return null;

  let historyAbove = 0;
  let target = boundary;
  for (let i = boundary - 1; i >= 0; i -= 1) {
    const row = rows[i];
    if (row.kind === "history") {
      historyAbove += 1;
      target = i;
      if (historyAbove >= LEDGER_ANCHOR_PAST_ROWS) break;
    }
    if (row.kind === "section" && row.id === "section-recent") {
      if (historyAbove === 0) target = i;
      break;
    }
  }
  return target;
}

export function ledgerRowHeight(row: TransactionListRow | undefined): number {
  if (!row) return LEDGER_ROW_HEIGHT;
  if (row.kind === "section") return LEDGER_SECTION_HEIGHT;
  if (row.kind === "skeleton") return LEDGER_SKELETON_HEIGHT;
  return LEDGER_ROW_HEIGHT;
}

export function estimateLedgerOffset(rows: TransactionListRow[], index: number): number {
  let offset = 0;
  const end = Math.max(0, Math.min(index, rows.length));
  for (let i = 0; i < end; i += 1) {
    offset += ledgerRowHeight(rows[i]);
  }
  return offset;
}

export function getLedgerItemLayout(rows: TransactionListRow[], index: number) {
  return {
    length: ledgerRowHeight(rows[index]),
    offset: estimateLedgerOffset(rows, index),
    index,
  };
}
