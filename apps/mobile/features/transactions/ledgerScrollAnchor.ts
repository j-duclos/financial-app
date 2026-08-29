import type { TransactionListRow } from "./buildTransactionList";

/** How many posted Recent rows to keep visible above Pending/Upcoming on open. */
export const LEDGER_ANCHOR_PAST_ROWS = 4;

/** Approximate heights for default (non-focus) open only. Never use for deep-link scroll. */
export const LEDGER_SECTION_HEIGHT = 56;
export const LEDGER_SECTION_WITH_RANGE_HEIGHT = 68;
export const LEDGER_ROW_HEIGHT = 88;
export const LEDGER_PENDING_ROW_HEIGHT = 100;
export const LEDGER_SKELETON_HEIGHT = 56;

export type LedgerFocusKind = "forecast-risk" | "ledger-event";

export type LedgerFocusParams = {
  focus: LedgerFocusKind;
  focusDate?: string | null;
  focusTransactionId?: number | null;
  focusRuleId?: number | null;
  /** Merchant / description snippet from Money Flow (matches ledger when ids disagree). */
  focusDescription?: string | null;
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

function normalizeDesc(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

function descriptionsLooselyMatch(a: string, b: string): boolean {
  const left = normalizeDesc(a);
  const right = normalizeDesc(b);
  if (!left || !right) return false;
  if (left === right) return true;
  const short = left.length <= right.length ? left : right;
  const long = left.length <= right.length ? right : left;
  if (short.length < 4) return false;
  return long.startsWith(short) || long.includes(short);
}

function rowDescription(row: TransactionListRow): string {
  if (row.kind === "history") return row.txn.payee ?? row.txn.memo ?? "";
  if (row.kind === "pending" || row.kind === "upcoming") return row.row.description ?? "";
  return "";
}

function rowMatchesFocusTransaction(
  row: TransactionListRow,
  focusTransactionId: number
): boolean {
  if (row.kind === "history") {
    return row.txn.id === focusTransactionId;
  }
  if (row.kind === "pending" || row.kind === "upcoming") {
    const r = row.row;
    return (
      r.transaction_id === focusTransactionId ||
      r.canonical_transaction_id === focusTransactionId ||
      r.fulfilled_by_transaction_id === focusTransactionId
    );
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

function rowMatchesFocusDate(row: TransactionListRow, focusDate: string): boolean {
  if (row.kind === "pending" || row.kind === "upcoming") {
    return row.row.date.slice(0, 10) === focusDate;
  }
  if (row.kind === "history") {
    return row.txn.date.slice(0, 10) === focusDate;
  }
  return false;
}

/**
 * Prefer an exact ledger row for Money Flow / Attention deep links.
 * Order: transaction id (+ date when present) → rule+date → date+description → first row on date.
 *
 * When focusDate is set, a transaction-id hit on a *different* day is ignored —
 * stale Expo params otherwise scroll Aug 30 taps onto a prior Sep shortfall row.
 */
export function findLedgerFocusIndex(
  rows: TransactionListRow[],
  focus: LedgerFocusParams
): number | null {
  const focusDate = focus.focusDate?.slice(0, 10) || null;

  if (focus.focusTransactionId != null) {
    const exact = rows.findIndex((row) => {
      if (!rowMatchesFocusTransaction(row, focus.focusTransactionId!)) return false;
      if (focusDate && !rowMatchesFocusDate(row, focusDate)) return false;
      return true;
    });
    if (exact >= 0) return exact;
  }

  if (focusDate && focus.focusRuleId != null) {
    const byRule = rows.findIndex((row) =>
      rowMatchesFocusRule(row, focus.focusRuleId!, focusDate)
    );
    if (byRule >= 0) return byRule;
  }

  const needle = focus.focusDescription?.trim() ?? "";
  if (focusDate && needle) {
    const byDesc = rows.findIndex(
      (row) =>
        rowMatchesFocusDate(row, focusDate) &&
        descriptionsLooselyMatch(rowDescription(row), needle)
    );
    if (byDesc >= 0) return byDesc;
  }

  if (focusDate) {
    const onDate = rows.findIndex(
      (row) =>
        (row.kind === "upcoming" || row.kind === "pending") &&
        rowMatchesFocusDate(row, focusDate)
    );
    if (onDate >= 0) return onDate;
    const historyOnDate = rows.findIndex(
      (row) => row.kind === "history" && rowMatchesFocusDate(row, focusDate)
    );
    if (historyOnDate >= 0) return historyOnDate;
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
 * Scroll target on open.
 *
 * Deep links return the focused row index, or null while that row is not in the
 * list yet (e.g. timeline still loading). Callers must NOT fall back to the
 * default Pending anchor until the timeline has settled — that was scrolling
 * users to the wrong place, then a later estimated jump landed on Sep 4.
 */
export function ledgerOpenScrollIndex(
  rows: TransactionListRow[],
  focus?: LedgerFocusParams | null,
  opts?: { allowDefaultWhenFocusMissing?: boolean }
): number | null {
  if (focus?.focus === "forecast-risk" || focus?.focus === "ledger-event") {
    const focused = findLedgerFocusIndex(rows, focus);
    if (focused != null) return focused;
    if (opts?.allowDefaultWhenFocusMissing) return ledgerAnchorScrollIndex(rows);
    return null;
  }
  return ledgerAnchorScrollIndex(rows);
}

export function ledgerRowHeight(row: TransactionListRow | undefined): number {
  if (!row) return LEDGER_ROW_HEIGHT;
  if (row.kind === "section") {
    return row.rangeLabel ? LEDGER_SECTION_WITH_RANGE_HEIGHT : LEDGER_SECTION_HEIGHT;
  }
  if (row.kind === "skeleton") return LEDGER_SKELETON_HEIGHT;
  if (row.kind === "pending") return LEDGER_PENDING_ROW_HEIGHT;
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

/**
 * Expo Router may give string | string[] for the same param.
 * When navigating to the same tab repeatedly, params often accumulate as an
 * array — take the *last* value so a prior Sep 4 focus cannot win over Aug 30.
 * A trailing "__none__" / empty means "cleared".
 */
export function firstSearchParam(
  value: string | string[] | undefined | null
): string {
  if (value == null) return "";
  if (Array.isArray(value)) {
    if (value.length === 0) return "";
    const last = String(value[value.length - 1] ?? "").trim();
    if (last === "" || last === "__none__") return "";
    return last;
  }
  const single = String(value).trim();
  return single === "__none__" ? "" : single;
}
