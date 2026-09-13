import type { TransactionListRow } from "./buildTransactionList";

/** Ordinary Transactions-tab open is always the top of the list. */
export const LEDGER_ORDINARY_OPEN_INDEX = 0;

/** @deprecated Ordinary open no longer backs up from Pending/Upcoming. */
export const LEDGER_OPEN_RECENT_ROWS = 0;

/** @deprecated Use LEDGER_ORDINARY_OPEN_INDEX */
export const LEDGER_ANCHOR_PAST_ROWS = LEDGER_OPEN_RECENT_ROWS;

/** Approximate row heights (focus fallback estimates only — never ordinary open). */
export const LEDGER_SECTION_HEIGHT = 52;
export const LEDGER_SECTION_WITH_RANGE_HEIGHT = 76;
export const LEDGER_ROW_HEIGHT = 88;
export const LEDGER_PENDING_ROW_HEIGHT = 100;
export const LEDGER_SKELETON_HEIGHT = 56;
export const LEDGER_MESSAGE_HEIGHT = 40;
export const LEDGER_LOAD_OLDER_HEIGHT = 52;

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

export function isLedgerActivityRow(row: TransactionListRow | undefined): boolean {
  return row?.kind === "history" || row?.kind === "pending" || row?.kind === "upcoming";
}

/**
 * Index of the ledger "now" boundary: Pending section if present, else Upcoming.
 * Returns null when the list has no pending/upcoming section.
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
 * Ordinary Transactions-tab open is always the top of the list.
 * Do not compute a Pending/Upcoming boundary anchor here.
 */
export function findDefaultLedgerOpenIndex(_rows: TransactionListRow[]): number {
  return LEDGER_ORDINARY_OPEN_INDEX;
}

/** @deprecated Use findDefaultLedgerOpenIndex */
export function ledgerAnchorScrollIndex(rows: TransactionListRow[]): number | null {
  return findDefaultLedgerOpenIndex(rows);
}

export type LedgerOpenMode = "ordinary" | "focus";

export function resolveLedgerOpenMode(focus?: LedgerFocusParams | null): LedgerOpenMode {
  if (focus?.focus === "forecast-risk" || focus?.focus === "ledger-event") return "focus";
  return "ordinary";
}

export function ordinaryLedgerPositionKey(input: {
  accountId: number | null | undefined;
  timeFilter: string;
  forecastDays: number;
}): string {
  return `${input.accountId ?? "none"}:${input.timeFilter}:${input.forecastDays}`;
}

/** Ordinary open never schedules delayed/programmatic scroll after first paint. */
export function shouldApplyOrdinaryProgrammaticScroll(): boolean {
  return false;
}

export function shouldApplyFocusScroll(opts: {
  userHasDragged: boolean;
  appliedKey: string | null;
  attemptKey: string;
}): boolean {
  if (opts.userHasDragged) return false;
  if (opts.appliedKey === opts.attemptKey) return false;
  return true;
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
 * Ordinary navigation always returns 0 (top of the list).
 * Deep links return the focused row index, or null while that row is not in the
 * list yet. Missing-focus fallback is also the top — never a boundary anchor.
 */
export function ledgerOpenScrollIndex(
  rows: TransactionListRow[],
  focus?: LedgerFocusParams | null,
  opts?: { allowDefaultWhenFocusMissing?: boolean }
): number | null {
  if (focus?.focus === "forecast-risk" || focus?.focus === "ledger-event") {
    const focused = findLedgerFocusIndex(rows, focus);
    if (focused != null) return focused;
    if (opts?.allowDefaultWhenFocusMissing) return LEDGER_ORDINARY_OPEN_INDEX;
    return null;
  }
  return LEDGER_ORDINARY_OPEN_INDEX;
}

export function ledgerRowHeight(row: TransactionListRow | undefined): number {
  if (!row) return LEDGER_ROW_HEIGHT;
  if (row.kind === "section") {
    return row.rangeLabel ? LEDGER_SECTION_WITH_RANGE_HEIGHT : LEDGER_SECTION_HEIGHT;
  }
  if (row.kind === "skeleton") return LEDGER_SKELETON_HEIGHT;
  if (row.kind === "pending") return LEDGER_PENDING_ROW_HEIGHT;
  if (row.kind === "message") return LEDGER_MESSAGE_HEIGHT;
  if (row.kind === "loadOlder") return LEDGER_LOAD_OLDER_HEIGHT;
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
