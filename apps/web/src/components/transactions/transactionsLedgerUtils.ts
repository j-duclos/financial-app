import type { Transaction, TimelineRow } from "@budget-app/shared";
export { formatDateDisplay, formatDateTimeDisplay } from "../../lib/dateDisplay";
import { formatDateDisplay } from "../../lib/dateDisplay";

/** Today's date in YYYY-MM-DD using local timezone (not UTC). */
export function todayStr(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function maxIsoDate(a: string, b: string): string {
  return a >= b ? a : b;
}

export function addDaysToIsoDate(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + days);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
}

/** Return YYYY-MM-DD for (today ± months) in local timezone. */
export function addMonths(months: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() + months);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export type TimeFilter = "14d" | "1m" | "3m" | "6m" | "12m" | "18m" | "24m" | "36m";

export const TIME_FILTER_MONTHS: Record<Exclude<TimeFilter, "14d">, number> = {
  "1m": 1,
  "3m": 3,
  "6m": 6,
  "12m": 12,
  "18m": 18,
  "24m": 24,
  "36m": 36,
};

/** Past/future window for the transactions ledger timeline query. */
export function timelineRangeForFilter(filter: TimeFilter): { start: string; end: string } {
  const today = todayStr();
  if (filter === "14d") {
    return {
      start: addDaysToIsoDate(today, -14),
      end: addDaysToIsoDate(today, 14),
    };
  }
  const months = TIME_FILTER_MONTHS[filter];
  return {
    start: addMonths(-months),
    end: addMonths(months),
  };
}

/** Narrow window for transfer/CC payoff hints — avoids building 15+ years of timeline on every date change. */
export function projectionTimelineRangeForAsOf(asOfDate: string): {
  start: string;
  end: string;
  as_of: string;
} {
  const as_of = maxIsoDate(asOfDate, todayStr());
  return {
    start: addDaysToIsoDate(as_of, -1095),
    end: addDaysToIsoDate(as_of, 1),
    as_of,
  };
}

export type LedgerRow =
  | { type: "starting_balance"; balance: number }
  | { type: "transaction"; txn: Transaction; balance: number }
  | { type: "today_balance"; balance: number }
  | { type: "transaction_from_timeline"; row: TimelineRow; balance: number }
  | { type: "recurring"; row: TimelineRow; balance: number };

/** Forecast/past timeline rows the user may edit (reconciled and interest are read-only). */
export function canEditLedgerTimelineRow(row: TimelineRow): boolean {
  if (row.reconciled) return false;
  if (row.source === "interest") return false;
  return true;
}

export function buildLedgerRows(
  transactions: Transaction[],
  startingBalance: number,
  _currency: string,
  isCredit: boolean,
  /** When set (e.g. timeline fallback), today's ending balance row uses the API ledger total. */
  todayBalanceOverride?: number | null
): LedgerRow[] {
  const start = startingBalance ?? 0;
  const today = todayStr();
  const sorted = [...transactions].sort((a, b) => a.date.localeCompare(b.date));
  const rows: LedgerRow[] = [];

  rows.push({ type: "starting_balance", balance: start });
  let running = start;
  let todayRowInserted = false;

  for (const txn of sorted) {
    if ((txn.source || "").toUpperCase() === "INTEREST") continue;
    if (!todayRowInserted && txn.date > today) {
      const bal =
        todayBalanceOverride != null && Number.isFinite(todayBalanceOverride)
          ? todayBalanceOverride
          : running;
      rows.push({ type: "today_balance", balance: bal });
      todayRowInserted = true;
    }
    const amt = parseFloat(txn.amount);
    const effective = isCredit && amt > 0 ? -amt : amt;
    running += effective;
    rows.push({ type: "transaction", txn, balance: running });
  }
  if (!todayRowInserted) {
    const bal =
      todayBalanceOverride != null && Number.isFinite(todayBalanceOverride)
        ? todayBalanceOverride
        : running;
    rows.push({ type: "today_balance", balance: bal });
  }
  return rows;
}

/** @deprecated Do not use for Starting Balance display — always show account.starting_balance. */
export function resolveFallbackLedgerOpening(
  transactions: Transaction[],
  today: string,
  balanceAtToday: number,
  isCredit: boolean
): number {
  let sumThroughToday = 0;
  for (const txn of transactions) {
    if ((txn.source || "").toUpperCase() === "INTEREST") continue;
    if (txn.date > today) continue;
    const amt = parseFloat(txn.amount);
    if (Number.isNaN(amt)) continue;
    const effective = isCredit && amt > 0 ? -amt : amt;
    sumThroughToday += effective;
  }
  return balanceAtToday - sumThroughToday;
}

/** Synthetic projected interest/income — forecast-only estimates, never historical ledger. */
export function isProjectedInterestRow(row: TimelineRow): boolean {
  return row.source === "interest";
}

/** Past ledger rows: on or before today, excluding projected interest (estimates only). */
export function isPastTimelineRow(row: TimelineRow, today: string): boolean {
  if (isProjectedInterestRow(row)) return false;
  return row.date <= today;
}

/** Forecast = strictly after today. Same-day rows (including planned rules) live in Past. */
export function isForecastTimelineRow(row: TimelineRow, today: string): boolean {
  return row.date > today;
}

/** Rule-generated row still in PLANNED status (not cleared by a bank import). */
export function isPlannedScheduledTimelineRow(row: TimelineRow): boolean {
  if ((row.status || "").toUpperCase() !== "PLANNED") return false;
  const matchStatus = (row.import_match_status ?? "").toLowerCase();
  // Matched to a bank import — the scheduled leg was replaced (even if status stays PLANNED).
  if (matchStatus === "matched") return false;
  if ((row.plaid_transaction_id ?? "").trim()) return false;
  if (row.source === "rule") return true;
  const txnSrc = (row.txn_source ?? "").toLowerCase();
  if (txnSrc === "rule") return true;
  // Materialized rule occurrences use source=actual, txn_source=rule, rule_id set.
  return row.rule_id != null && row.source === "actual";
}

/** Match backend SAME_ACCOUNT_DATE_WINDOW_DAYS — payroll may post before the scheduled date. */
const SCHEDULE_IMPORT_DATE_WINDOW_DAYS = 5;

function daysBetweenIsoDates(a: string, b: string): number {
  const [y1, m1, d1] = a.split("-").map(Number);
  const [y2, m2, d2] = b.split("-").map(Number);
  const t1 = new Date(y1, m1 - 1, d1).getTime();
  const t2 = new Date(y2, m2 - 1, d2).getTime();
  return Math.abs(Math.round((t2 - t1) / 86_400_000));
}

function amountsMatch(a: number, b: number): boolean {
  return Math.abs(Math.abs(a) - Math.abs(b)) < 0.01;
}

function normalizePayee(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function descriptionsLikelySame(a: string, b: string): boolean {
  const na = normalizePayee(a);
  const nb = normalizePayee(b);
  if (!na || !nb) return false;
  if (na === nb || na.includes(nb) || nb.includes(na)) return true;
  const short = na.length <= nb.length ? na : nb;
  const long = na.length <= nb.length ? nb : na;
  const tokens = short.split(/\s+/).filter((w) => w.length >= 4);
  return tokens.length > 0 && tokens.some((t) => long.includes(t));
}

function plannedAndPostingLikelySame(planned: TimelineRow, posting: TimelineRow): boolean {
  const amt = parseFloat(planned.amount);
  const otherAmt = parseFloat(posting.amount);
  if (Number.isNaN(amt) || Number.isNaN(otherAmt)) return false;
  if (!amountsMatch(amt, otherAmt)) return false;
  if (
    planned.rule_id != null &&
    posting.rule_id != null &&
    planned.rule_id === posting.rule_id
  ) {
    return true;
  }
  return descriptionsLikelySame(planned.description || "", posting.description || "");
}

/** Plaid row not yet linked to a scheduled/automation occurrence. */
function isUnmatchedPlaidImportTimelineRow(row: TimelineRow): boolean {
  const status = (row.import_match_status ?? "").toLowerCase();
  if (status === "matched" || status === "ignored" || status === "duplicate") return false;
  const txnSrc = (row.txn_source ?? "").toLowerCase();
  if (txnSrc === "plaid") return true;
  return Boolean((row.plaid_transaction_id ?? "").trim());
}

/** Bank import or cleared posting (not a forecast-only rule row). */
export function isImportedTimelineRow(row: TimelineRow): boolean {
  if (row.source === "interest") return false;
  if (isPlannedScheduledTimelineRow(row)) return false;
  const status = (row.status || "").toUpperCase();
  if (status === "PLANNED") return false;
  const txnSrc = (row.txn_source ?? "").toLowerCase();
  if (txnSrc === "plaid") return true;
  if ((row.plaid_transaction_id ?? "").trim()) return true;
  if (status === "CLEARED" || status === "RECONCILED") return true;
  return row.source === "actual" && row.transaction_id != null;
}

/**
 * Highlight scheduled rows when an unmatched bank import looks like the same charge
 * (amount + payee, within ±5 days — payroll often posts before the automation date).
 */
export function shouldHighlightUnmatchedScheduledRow(
  row: TimelineRow,
  timeline: TimelineRow[]
): boolean {
  if (!isPlannedScheduledTimelineRow(row)) return false;
  if (isSupersededPlannedTimelineRow(row, timeline)) return false;
  const accountId = Number(row.account_id);
  for (const other of timeline) {
    if (Number(other.account_id) !== accountId) continue;
    if (!isImportedTimelineRow(other)) continue;
    if (daysBetweenIsoDates(other.date, row.date) > SCHEDULE_IMPORT_DATE_WINDOW_DAYS) continue;
    if (plannedAndPostingLikelySame(row, other)) return true;
  }
  return false;
}

/** Drop a today/past PLANNED row when the same account+day already has a matching cleared posting. */
export function isSupersededPlannedTimelineRow(
  row: TimelineRow,
  timeline: TimelineRow[]
): boolean {
  const status = (row.status || "").toUpperCase();
  if (status !== "PLANNED") return false;
  const amt = parseFloat(row.amount);
  if (Number.isNaN(amt)) return false;
  const absAmt = Math.abs(amt);
  for (const other of timeline) {
    if (other === row || other.date !== row.date || other.account_id !== row.account_id) {
      continue;
    }
    const otherStatus = (other.status || "").toUpperCase();
    if (otherStatus !== "CLEARED" && otherStatus !== "RECONCILED") continue;
    if (row.rule_id != null && other.rule_id === row.rule_id) return true;
    // Keep both rows visible (highlight planned) until an unmatched Plaid import is linked.
    if (isUnmatchedPlaidImportTimelineRow(other) && plannedAndPostingLikelySame(row, other)) {
      continue;
    }
    const otherAmt = parseFloat(other.amount);
    if (!Number.isNaN(otherAmt) && Math.abs(Math.abs(otherAmt) - absAmt) < 0.01) {
      return true;
    }
  }
  return false;
}

/**
 * Apply a timeline amount to a running ledger balance.
 * Credit cards use positive running values as amount owed (charges up, payments down).
 */
export function applyTimelineAmountToBalance(
  running: number,
  amount: number,
  isCredit: boolean
): number {
  let next: number;
  if (!isCredit) {
    next = running + amount;
  } else if (amount < 0) {
    next = running + Math.abs(amount);
  } else {
    next = running - amount;
  }
  return isCredit ? Math.abs(next) : next;
}

/**
 * Opening balance for the ledger UI from account settings (not inferred from timeline rows).
 * Credit cards: user enters amount owed as a positive number (0 = no opening debt).
 */
export function ledgerOpeningBalance(
  startingBalance: string | number | null | undefined,
  isCredit: boolean
): number {
  if (startingBalance == null || String(startingBalance).trim() === "") return 0;
  const sb = parseFloat(String(startingBalance));
  if (Number.isNaN(sb)) return 0;
  return isCredit ? Math.abs(sb) : sb;
}

/**
 * Bank/cash: infer opening from the first visible timeline row (already includes account start in the chain).
 * Credit: use configured starting balance only — do not back-solve from signed running_balance.
 */
export function resolveLedgerOpening(
  startingBalanceFromAccount: string | number | null | undefined,
  firstPastRow: TimelineRow | undefined,
  isCredit: boolean
): number {
  if (isCredit) return ledgerOpeningBalance(startingBalanceFromAccount, true);
  if (firstPastRow) {
    return parseFloat(firstPastRow.running_balance) - parseFloat(firstPastRow.amount);
  }
  return ledgerOpeningBalance(startingBalanceFromAccount, false);
}

/** Current balance from account API fields (list/retrieve with ?balance=true). */
export function accountLedgerDisplayBalance(
  account: {
    available_balance?: string | null;
    balance?: string | null;
    balance_owed?: string | null;
    current_balance?: string | null;
    forecast_summary?: { current_balance?: string | null } | null;
  },
  isCredit: boolean
): number {
  const parse = (raw: string | null | undefined): number | null => {
    if (raw == null || String(raw).trim() === "") return null;
    const n = parseFloat(String(raw));
    return Number.isNaN(n) ? null : n;
  };

  if (isCredit) {
    const owed = parse(account.balance_owed ?? account.current_balance);
    if (owed != null && owed > 0) return owed;
    const signed = parse(account.balance);
    if (signed != null && signed < 0) return Math.abs(signed);
    const forecastSigned = parse(account.forecast_summary?.current_balance);
    if (forecastSigned != null && forecastSigned < 0) return Math.abs(forecastSigned);
    return owed ?? 0;
  }

  const raw =
    account.available_balance ??
    account.balance ??
    account.forecast_summary?.current_balance;
  const n = parse(raw);
  return n ?? 0;
}

/** Match backend timeline row ordering (date, then transaction id, then description). */
export function compareTimelineRows(a: TimelineRow, b: TimelineRow): number {
  const cmp = a.date.localeCompare(b.date);
  if (cmp !== 0) return cmp;
  const ta = a.transaction_id ?? -1;
  const tb = b.transaction_id ?? -1;
  if (ta !== tb) return ta - tb;
  return String(a.description).localeCompare(String(b.description));
}

export function buildLedgerRowsFromTimeline(
  timeline: TimelineRow[],
  today: string,
  openingBalance: number,
  isCredit: boolean,
  pastOpeningOverride?: number | null,
): LedgerRow[] {
  const past = timeline
    .filter((r) => isPastTimelineRow(r, today))
    .filter((r) => !isSupersededPlannedTimelineRow(r, timeline))
    .sort(compareTimelineRows);
  const future = timeline
    .filter((r) => isForecastTimelineRow(r, today))
    .sort(compareTimelineRows);

  const rows: LedgerRow[] = [];
  const configuredOpening = ledgerOpeningBalance(openingBalance, isCredit);
  const start =
    pastOpeningOverride != null && Number.isFinite(pastOpeningOverride)
      ? pastOpeningOverride
      : isCredit
        ? resolveLedgerOpening(openingBalance, past[0], isCredit)
        : configuredOpening;
  rows.push({ type: "starting_balance", balance: start });

  // Recompute from visible rows only — API running_balance can include filtered duplicates.
  let running = start;
  for (const r of past) {
    running = applyTimelineAmountToBalance(running, parseFloat(r.amount), isCredit);
    rows.push({
      type: "transaction_from_timeline",
      row: r,
      balance: running,
    });
  }

  const todayBalance = running;
  rows.push({ type: "today_balance", balance: todayBalance });

  let forecastRunning = todayBalance;
  for (const r of future) {
    forecastRunning = applyTimelineAmountToBalance(
      forecastRunning,
      parseFloat(r.amount),
      isCredit
    );
    rows.push({
      type: "recurring",
      row: r,
      balance: forecastRunning,
    });
  }
  return rows;
}

/** Use API timeline for the ledger when it has rows for this account (else fall back to /transactions/). */
export function timelineHasAccountRows(
  timeline: TimelineRow[] | undefined | null,
  accountId: number
): boolean {
  if (!Array.isArray(timeline) || timeline.length === 0) return false;
  const aid = Number(accountId);
  return timeline.some((r) => Number(r.account_id) === aid);
}

/** Lowest running balance in the forecast ledger (matches visible Transactions forecast rows). */
export function lowestProjectedFromLedgerFuture(
  future: LedgerRow[]
): { balance: number; date: string } | null {
  let result: { balance: number; date: string } | null = null;
  for (const row of future) {
    let rowDate: string | null = null;
    if (row.type === "recurring" || row.type === "transaction_from_timeline") {
      rowDate = row.row.date;
    } else if (row.type === "transaction") {
      rowDate = row.txn.date;
    }
    if (!rowDate) continue;
    if (result === null || row.balance < result.balance) {
      result = { balance: row.balance, date: rowDate };
    }
  }
  return result;
}

export function splitLedgerSections(rows: LedgerRow[]) {
  const today = todayStr();
  const start = rows.find((r) => r.type === "starting_balance") ?? null;
  const todayRow = rows.find((r) => r.type === "today_balance") ?? null;
  const past: LedgerRow[] = [];
  const future: LedgerRow[] = [];
  for (const r of rows) {
    if (r.type === "transaction_from_timeline") {
      past.push(r);
    } else if (r.type === "transaction") {
      if (r.txn.date <= today) past.push(r);
      else future.push(r);
    } else if (r.type === "recurring") {
      future.push(r);
    }
  }
  return { start, past, today: todayRow, future };
}

/**
 * Signed ledger balance for a credit card at end of `asOfDate` (matches backend timeline math).
 * Negative = debt owed. Recomputes from visible rows so excluded / superseded rows are not counted.
 */
export function creditCardSignedBalanceAtDate(
  timeline: TimelineRow[],
  cardAccountId: number,
  asOfDate: string,
  excludeTransactionIds: Set<number>
): number | null {
  const aid = Number(cardAccountId);
  const rows = timeline
    .filter((r) => Number(r.account_id) === aid && r.date <= asOfDate)
    .filter((r) => !isProjectedInterestRow(r))
    .filter((r) => r.transaction_id == null || !excludeTransactionIds.has(r.transaction_id))
    .filter((r) => !isSupersededPlannedTimelineRow(r, timeline))
    .sort(compareTimelineRows);
  if (rows.length === 0) return null;

  const rb0 = parseFloat(rows[0].running_balance);
  const a0 = parseFloat(rows[0].amount);
  let signed = !Number.isNaN(rb0) && !Number.isNaN(a0) ? rb0 - a0 : 0;
  for (const r of rows) {
    const amt = parseFloat(r.amount);
    if (!Number.isNaN(amt)) signed += amt;
  }
  return signed;
}

export function creditOwedAsOfDateFromTimeline(
  timeline: TimelineRow[],
  cardAccountId: number,
  paymentDate: string,
  excludeTransactionIds: Set<number>
): number | null {
  const signed = creditCardSignedBalanceAtDate(
    timeline,
    cardAccountId,
    paymentDate,
    excludeTransactionIds
  );
  if (signed == null) return null;
  return signed < 0 ? Math.abs(signed) : 0;
}

export function assetBalanceAsOfDateFromTimeline(
  timeline: TimelineRow[],
  accountId: number,
  asOfDate: string,
  excludeTransactionIds: Set<number>
): number | null {
  const aid = Number(accountId);
  const rows = timeline
    .filter((r) => Number(r.account_id) === aid && r.date <= asOfDate)
    .filter((r) => !isProjectedInterestRow(r))
    .filter((r) => r.transaction_id == null || !excludeTransactionIds.has(r.transaction_id))
    .filter((r) => !isSupersededPlannedTimelineRow(r, timeline))
    .sort(compareTimelineRows);
  if (rows.length === 0) return null;

  const rb0 = parseFloat(rows[0].running_balance);
  const a0 = parseFloat(rows[0].amount);
  let signed = !Number.isNaN(rb0) && !Number.isNaN(a0) ? rb0 - a0 : 0;
  for (const r of rows) {
    const amt = parseFloat(r.amount);
    if (!Number.isNaN(amt)) signed += amt;
  }
  return signed;
}

/** Credit ledger balances represent debt owed — always red when non-zero. */
export function creditBalanceColorClass(isCredit: boolean, balance = 0): string {
  if (!isCredit) return "text-gray-900";
  if (Math.abs(balance) < 0.005) return "text-gray-500";
  return "text-red-600";
}

export function categoryLabel(name: string | null | undefined, description?: string): string {
  return name || (description === "Transfer" ? "Bank Transfer" : "—");
}

export function isTransferCategoryName(name: string | undefined): boolean {
  return name === "Transfer" || name === "Bank Transfer" || name === "Credit Card Payment";
}

export type ViewMode = "timeline" | "balance";
