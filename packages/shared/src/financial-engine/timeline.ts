/**
 * Pure canonical timeline walk.
 *
 * Ports `assign_canonical_ledger_balance_after` + helpers from
 * `backend/timeline/services/ledger_section_balances.py`.
 *
 * Does not query a database, expand recurring rules, match Plaid imports,
 * project interest, or resolve identity/supersede/shadow. Callers pass
 * already-loaded rows and per-account posted-before-pending anchors.
 */
import { addCents, centsToDollars, dollarsToCents } from "./money";
import { isoDatePart, isIsoDateAfter, isIsoDateOnOrBefore } from "./dates";
import type { EngineTimelineRow, EngineTimelineRowInput } from "./types";

function rowDate(row: Pick<EngineTimelineRowInput, "date">): string {
  return isoDatePart(String(row.date));
}

function rowStatus(row: EngineTimelineRowInput): string {
  return String(row.status || "").toUpperCase();
}

function isProjectedInterest(row: EngineTimelineRowInput): boolean {
  return String(row.source || "").toLowerCase() === "interest";
}

/** Match Python `_is_planned_scheduled`. */
export function isPlannedScheduledTimelineRow(row: EngineTimelineRowInput): boolean {
  if (rowStatus(row) !== "PLANNED") return false;
  const matchStatus = String(row.import_match_status || "").toLowerCase();
  if (matchStatus === "matched") return false;
  if (String(row.plaid_transaction_id || "").trim()) return false;
  const source = String(row.source || "").toLowerCase();
  if (source === "interest") return false;
  if (source === "rule") return true;
  const txnSrc = String(row.txn_source || "").toLowerCase();
  if (txnSrc === "rule") return true;
  if (row.rule_id != null && source === "actual") return true;
  if (source === "one_time" || txnSrc === "one_time") return true;
  return false;
}

export function isPendingExpectedTimelineRow(row: EngineTimelineRowInput, today: string): boolean {
  if (isProjectedInterest(row)) return false;
  return isIsoDateOnOrBefore(rowDate(row), today) && isPlannedScheduledTimelineRow(row);
}

export function isForecastTimelineRow(row: EngineTimelineRowInput, today: string): boolean {
  return isIsoDateAfter(rowDate(row), today);
}

/**
 * Match Python `signed_timeline_ledger_amount`.
 * OUTFLOW/EXPENSE force negative; INFLOW/INCOME force positive.
 */
export function signedTimelineLedgerAmountCents(row: EngineTimelineRowInput): bigint {
  const raw = dollarsToCents(row.amount || "0");
  const abs = raw < 0n ? -raw : raw;
  const rowType = String(row.type || "").toUpperCase();
  if (rowType === "OUTFLOW" || rowType === "EXPENSE") return -abs;
  if (rowType === "INFLOW" || rowType === "INCOME") return abs;
  return raw;
}

function transactionIdKey(row: EngineTimelineRowInput): number {
  return row.transaction_id == null ? 0 : Number(row.transaction_id);
}

/** Match Python `_sort_key`: (date, transaction_id or 0, description) — description not lowercased. */
export function compareCanonicalWalkOrder(a: EngineTimelineRowInput, b: EngineTimelineRowInput): number {
  const da = rowDate(a);
  const db = rowDate(b);
  if (da !== db) return da < db ? -1 : 1;
  const ta = transactionIdKey(a);
  const tb = transactionIdKey(b);
  if (ta !== tb) return ta < tb ? -1 : 1;
  const sa = String(a.description || "");
  const sb = String(b.description || "");
  if (sa !== sb) return sa < sb ? -1 : 1;
  return 0;
}

function rowParticipates(row: EngineTimelineRowInput): boolean {
  if (row.financially_active === false) return false;
  return true;
}

export function cloneTimelineRow(row: EngineTimelineRowInput): EngineTimelineRow {
  return { ...row };
}

/**
 * Pending then Upcoming rows for one account — same sequence as Transactions Bal.
 */
export function transactionsLedgerWalkRows(
  rows: readonly EngineTimelineRowInput[],
  options: { accountId: number; today: string; endDate?: string | null }
): EngineTimelineRowInput[] {
  const accountRows = rows.filter((r) => Number(r.account_id) === Number(options.accountId));
  const pending = accountRows
    .filter((r) => isPendingExpectedTimelineRow(r, options.today))
    .sort(compareCanonicalWalkOrder);
  const upcoming = accountRows
    .filter((r) => isForecastTimelineRow(r, options.today))
    .sort(compareCanonicalWalkOrder);
  const walk: EngineTimelineRowInput[] = [];
  for (const row of [...pending, ...upcoming]) {
    if (!rowParticipates(row)) continue;
    if (options.endDate != null && isIsoDateAfter(rowDate(row), options.endDate)) continue;
    walk.push(row);
  }
  return walk;
}

export function assignCanonicalLedgerBalanceAfter(
  rows: EngineTimelineRow[],
  options: {
    today: string;
    anchors: Readonly<Record<number, string>>;
    accountIds?: readonly number[];
  }
): EngineTimelineRow[] {
  if (rows.length === 0) return rows;

  const accountIds = options.accountIds
    ? [...options.accountIds]
    : [
        ...new Set(
          rows
            .map((r) => r.account_id)
            .filter((id): id is number => id != null)
            .map((id) => Number(id))
        ),
      ];
  accountIds.sort((a, b) => a - b);

  for (const aid of accountIds) {
    const anchorRaw = options.anchors[aid];
    if (anchorRaw == null) continue;
    const walk = transactionsLedgerWalkRows(rows, { accountId: aid, today: options.today });
    let running = dollarsToCents(anchorRaw);
    for (const row of walk) {
      running = addCents(running, signedTimelineLedgerAmountCents(row));
      row.balance_after = centsToDollars(running);
    }
  }
  return rows;
}

export function buildTimeline(input: {
  accounts: readonly { id: number; posted_balance_before_pending: string }[];
  rows: readonly EngineTimelineRowInput[];
  today: string;
}): EngineTimelineRow[] {
  const cloned = input.rows.map(cloneTimelineRow);
  const anchors: Record<number, string> = {};
  for (const account of input.accounts) {
    anchors[account.id] = account.posted_balance_before_pending;
  }
  return assignCanonicalLedgerBalanceAfter(cloned, { today: input.today, anchors });
}
