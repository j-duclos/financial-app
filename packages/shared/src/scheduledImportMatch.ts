import type { TimelineRow } from "./types";

/** Match backend SAME_ACCOUNT_DATE_WINDOW_DAYS — payroll may post before the scheduled date. */
export const SCHEDULE_IMPORT_DATE_WINDOW_DAYS = 5;

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

export function isPlannedScheduledTimelineRow(row: TimelineRow): boolean {
  if ((row.status || "").toUpperCase() !== "PLANNED") return false;
  const matchStatus = (row.import_match_status ?? "").toLowerCase();
  if (matchStatus === "matched") return false;
  if ((row.plaid_transaction_id ?? "").trim()) return false;
  if (row.source === "rule") return true;
  const txnSrc = (row.txn_source ?? "").toLowerCase();
  if (txnSrc === "rule") return true;
  return row.rule_id != null && row.source === "actual";
}

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

function isPairedTransferTimelineRow(row: TimelineRow): boolean {
  return (row as TimelineRow & { transfer_group_id?: number | null }).transfer_group_id != null;
}

function isTransferLegImportConfirmed(row: TimelineRow): boolean {
  if (!isPairedTransferTimelineRow(row)) return false;
  const matchStatus = (row.import_match_status ?? "").toLowerCase();
  if (matchStatus === "matched") return true;
  return Boolean((row.plaid_transaction_id ?? "").trim());
}

function isShadowedByMatchedRuleSibling(row: TimelineRow, timeline: TimelineRow[]): boolean {
  if (isPairedTransferTimelineRow(row)) return false;
  if (row.rule_id == null) return false;
  const accountId = Number(row.account_id);
  const amt = parseFloat(row.amount);
  if (Number.isNaN(amt)) return false;
  for (const other of timeline) {
    if (Number(other.account_id) !== accountId || other.rule_id !== row.rule_id) continue;
    if ((other.import_match_status ?? "").toLowerCase() !== "matched") continue;
    if (daysBetweenIsoDates(other.date, row.date) > SCHEDULE_IMPORT_DATE_WINDOW_DAYS) continue;
    const otherAmt = parseFloat(other.amount);
    if (!Number.isNaN(otherAmt) && amountsMatch(amt, otherAmt)) return true;
  }
  return false;
}

function isSupersededPlannedTimelineRow(row: TimelineRow, timeline: TimelineRow[]): boolean {
  if (isPairedTransferTimelineRow(row)) return false;
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
    if (isUnmatchedPlaidImportTimelineRow(other) && plannedAndPostingLikelySame(row, other)) {
      continue;
    }
    const otherAmt = parseFloat(other.amount);
    if (!Number.isNaN(otherAmt) && amountsMatch(absAmt, Math.abs(otherAmt))) return true;
  }
  return false;
}

/**
 * Scheduled row has a matching bank/import row already on the ledger (Recent or timeline).
 * Used to offer "Matched Import" — dismiss the planned duplicate via skip/remove.
 */
export function scheduledRowHasMatchingImport(row: TimelineRow, timeline: TimelineRow[]): boolean {
  if (!isPlannedScheduledTimelineRow(row)) return false;
  if (isTransferLegImportConfirmed(row)) return false;
  if (isShadowedByMatchedRuleSibling(row, timeline)) return false;
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
