import type { Transaction, TimelineRow } from "@budget-app/shared";

/** Today's date in YYYY-MM-DD using local timezone (not UTC). */
export function todayStr(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Format YYYY-MM-DD for display as MM-DD-YYYY. */
export function formatDateDisplay(isoDate: string): string {
  if (!isoDate) return isoDate;
  const [y, m, d] = isoDate.split("-");
  return m && d && y ? `${m}-${d}-${y}` : isoDate;
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

export type TimeFilter = "1m" | "3m" | "6m" | "12m" | "18m" | "24m" | "36m";

export const TIME_FILTER_MONTHS: Record<TimeFilter, number> = {
  "1m": 1,
  "3m": 3,
  "6m": 6,
  "12m": 12,
  "18m": 18,
  "24m": 24,
  "36m": 36,
};

export type LedgerRow =
  | { type: "starting_balance"; balance: number }
  | { type: "transaction"; txn: Transaction; balance: number }
  | { type: "today_balance"; balance: number }
  | { type: "transaction_from_timeline"; row: TimelineRow; balance: number }
  | { type: "recurring"; row: TimelineRow; balance: number };

export function buildLedgerRows(
  transactions: Transaction[],
  startingBalance: number,
  _currency: string,
  isCredit: boolean
): LedgerRow[] {
  const start = startingBalance ?? 0;
  const today = todayStr();
  const sorted = [...transactions].sort((a, b) => a.date.localeCompare(b.date));
  const rows: LedgerRow[] = [];

  rows.push({ type: "starting_balance", balance: start });
  let running = start;
  let todayRowInserted = false;

  for (const txn of sorted) {
    if (!todayRowInserted && txn.date > today) {
      rows.push({ type: "today_balance", balance: running });
      todayRowInserted = true;
    }
    const amt = parseFloat(txn.amount);
    const effective = isCredit && amt > 0 ? -amt : amt;
    running += effective;
    rows.push({ type: "transaction", txn, balance: running });
  }
  if (!todayRowInserted) {
    rows.push({ type: "today_balance", balance: running });
  }
  return rows;
}

export function buildLedgerRowsFromTimeline(
  timeline: TimelineRow[],
  today: string,
  _accountBalance: number,
  _isCredit: boolean
): LedgerRow[] {
  const past = timeline.filter((r) => r.date <= today).sort((a, b) => a.date.localeCompare(b.date));
  const future = timeline.filter((r) => r.date > today).sort((a, b) => a.date.localeCompare(b.date));

  const rows: LedgerRow[] = [];
  const start =
    past.length > 0 ? parseFloat(past[0].running_balance) - parseFloat(past[0].amount) : _accountBalance;
  rows.push({ type: "starting_balance", balance: start });
  for (const r of past) {
    rows.push({
      type: "transaction_from_timeline",
      row: r,
      balance: parseFloat(r.running_balance),
    });
  }
  const todayBalance =
    past.length > 0 ? parseFloat(past[past.length - 1].running_balance) : _accountBalance;
  rows.push({ type: "today_balance", balance: todayBalance });
  for (const r of future) {
    rows.push({
      type: "recurring",
      row: r,
      balance: parseFloat(r.running_balance),
    });
  }
  return rows;
}

export function splitLedgerSections(rows: LedgerRow[]) {
  const start = rows.find((r) => r.type === "starting_balance") ?? null;
  const today = rows.find((r) => r.type === "today_balance") ?? null;
  const past: LedgerRow[] = [];
  const future: LedgerRow[] = [];
  for (const r of rows) {
    if (r.type === "transaction" || r.type === "transaction_from_timeline") past.push(r);
    if (r.type === "recurring") future.push(r);
  }
  return { start, past, today, future };
}

export function creditOwedAsOfDateFromTimeline(
  timeline: TimelineRow[],
  cardAccountId: number,
  paymentDate: string,
  excludeTransactionIds: Set<number>
): number | null {
  const forAcc = timeline
    .filter((r) => r.account_id === cardAccountId)
    .sort((a, b) => {
      const cmp = a.date.localeCompare(b.date);
      if (cmp !== 0) return cmp;
      const ta = a.transaction_id ?? -1;
      const tb = b.transaction_id ?? -1;
      if (ta !== tb) return ta - tb;
      return String(a.description).localeCompare(String(b.description));
    });
  if (forAcc.length === 0) return null;
  let bal = parseFloat(forAcc[0].running_balance) - parseFloat(forAcc[0].amount);
  for (const r of forAcc) {
    if (r.date > paymentDate) break;
    if (r.transaction_id != null && excludeTransactionIds.has(r.transaction_id)) continue;
    bal += parseFloat(r.amount);
  }
  return bal < 0 ? -bal : 0;
}

export function assetBalanceAsOfDateFromTimeline(
  timeline: TimelineRow[],
  accountId: number,
  asOfDate: string,
  excludeTransactionIds: Set<number>
): number | null {
  const forAcc = timeline
    .filter((r) => r.account_id === accountId)
    .sort((a, b) => {
      const cmp = a.date.localeCompare(b.date);
      if (cmp !== 0) return cmp;
      const ta = a.transaction_id ?? -1;
      const tb = b.transaction_id ?? -1;
      if (ta !== tb) return ta - tb;
      return String(a.description).localeCompare(String(b.description));
    });
  if (forAcc.length === 0) return null;
  let bal = parseFloat(forAcc[0].running_balance) - parseFloat(forAcc[0].amount);
  for (const r of forAcc) {
    if (r.date > asOfDate) break;
    if (r.transaction_id != null && excludeTransactionIds.has(r.transaction_id)) continue;
    bal += parseFloat(r.amount);
  }
  return bal;
}

export function categoryLabel(name: string | null | undefined, description?: string): string {
  return name || (description === "Transfer" ? "Bank Transfer" : "—");
}

export function isTransferCategoryName(name: string | undefined): boolean {
  return name === "Transfer" || name === "Bank Transfer" || name === "Credit Card Payment";
}

export type ViewMode = "timeline" | "balance";
