import type { TimelineRow, Transaction } from "@budget-app/shared";

/** Synthetic projected interest/income — forecast-only estimates, never Pending. */
export function isProjectedInterestRow(row: TimelineRow): boolean {
  return row.source === "interest";
}

/** Rule-generated timeline row still in PLANNED status (not cleared by a bank import). */
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

/** Rule-backed or one-time planned row from /transactions/ (mirrors timeline helper). */
export function isPlannedScheduledTransaction(txn: Transaction): boolean {
  if ((txn.status || "").toUpperCase() !== "PLANNED") return false;
  const matchStatus = (txn.import_match_status ?? "").toLowerCase();
  if (matchStatus === "matched") return false;
  if ((txn.plaid_transaction_id ?? "").trim()) return false;
  const src = (txn.source || "").toUpperCase();
  if (src === "INTEREST") return false;
  if (src === "RULE") return true;
  if (txn.rule_id != null) return true;
  if (src === "ONE_TIME") return true;
  return false;
}

/** Due scheduled row waiting for bank import or manual posting (web Pending section). */
export function isPendingExpectedTransaction(txn: Transaction, today: string): boolean {
  return txn.date <= today && isPlannedScheduledTransaction(txn);
}

/** Expected automation row whose scheduled date has arrived but is not yet confirmed. */
export function isPendingExpectedTimelineRow(row: TimelineRow, today: string): boolean {
  if (isProjectedInterestRow(row)) return false;
  return row.date <= today && isPlannedScheduledTimelineRow(row);
}

/** Forecast = strictly after today. Same-day/past planned rules move to Pending. */
export function isForecastTimelineRow(row: TimelineRow, today: string): boolean {
  return row.date > today;
}
