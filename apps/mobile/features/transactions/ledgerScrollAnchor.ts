import type { TransactionListRow } from "./buildTransactionList";

/** How many posted Recent rows to keep visible above Pending/Upcoming on open. */
export const LEDGER_ANCHOR_PAST_ROWS = 4;

/** Approximate heights for getItemLayout / initialScrollIndex (variable UI → close enough). */
export const LEDGER_SECTION_HEIGHT = 48;
export const LEDGER_ROW_HEIGHT = 76;
export const LEDGER_SKELETON_HEIGHT = 56;

export type LedgerFocusKind = "forecast-risk" | "ledger-event";

export type LedgerFocusParams = {
  focus: LedgerFocusKind;
  focusDate?: string | null;
  focusTransactionId?: number | null;
  focusRuleId?: number | null;
};

/** @deprecated Use LedgerFocusParams */
export type LedgerForecastFocus = LedgerFocusParams;

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

function rowMatchesFocusTransaction(
  row: TransactionListRow,
  focusTransactionId: number
): boolean {
  if (row.kind === "history") {
    return row.txn.id === focusTransactionId;
  }
  if (row.kind === "pending" || row.kind === "upcoming") {
    return row.row.transaction_id === focusTransactionId;
  }
  return false;
}

function rowMatchesFocusRule(
  row: TransactionListRow,
  focusRuleId: number,
  focusDate: string
): boolean {
  if (row.kind !== "pending" && row.kind !== "upcoming") return false;
  if (row.row.date.slice(0, 10) !== focusDate.slice(0, 10)) return false;
  return row.row.rule_id === focusRuleId;
}

/** Prefer an exact ledger row; fall back to rule+date, then first Upcoming row on focusDate. */
export function findLedgerFocusIndex(
  rows: TransactionListRow[],
  focus: LedgerFocusParams
): number | null {
  if (focus.focusTransactionId != null) {
    const exact = rows.findIndex((row) =>
      rowMatchesFocusTransaction(row, focus.focusTransactionId!)
    );
    if (exact >= 0) return exact;
  }

  const focusDate = focus.focusDate?.slice(0, 10);
  if (focusDate && focus.focusRuleId != null) {
    const byRule = rows.findIndex((row) =>
      rowMatchesFocusRule(row, focus.focusRuleId!, focusDate)
    );
    if (byRule >= 0) return byRule;
  }

  if (focusDate) {
    const onDate = rows.findIndex(
      (row) =>
        (row.kind === "upcoming" || row.kind === "pending") &&
        row.row.date.slice(0, 10) === focusDate
    );
    if (onDate >= 0) return onDate;
  }

  return null;
}

/** @deprecated Use findLedgerFocusIndex */
export function findLedgerForecastFocusIndex(
  rows: TransactionListRow[],
  focus: LedgerFocusParams
): number | null {
  return findLedgerFocusIndex(rows, focus);
}

/**
 * Scroll target on open — deep links prefer the focused row;
 * normal tab opens keep the Recent/Pending boundary anchor.
 */
export function ledgerOpenScrollIndex(
  rows: TransactionListRow[],
  focus?: LedgerFocusParams | null
): number | null {
  if (focus?.focus === "forecast-risk" || focus?.focus === "ledger-event") {
    const focused = findLedgerFocusIndex(rows, focus);
    if (focused != null) return focused;
  }
  return ledgerAnchorScrollIndex(rows);
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
