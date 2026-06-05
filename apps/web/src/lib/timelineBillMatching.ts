import type { BillChecklistItem, TimelineCalendarDay, TimelineCalendarTransaction } from "@budget-app/shared";
import { parseAmount } from "./timelineCalendarUtils";

export function monthKeyFromIso(isoDate: string): string {
  return isoDate.slice(0, 7);
}

export function parseRuleIdFromTimelineTxn(txn: TimelineCalendarTransaction): number | null {
  if (typeof txn.id !== "string") return null;
  const match = /^r-(\d+)-/.exec(txn.id);
  if (!match) return null;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Recurring bill / subscription / rule-projected payment (not one-off expenses). */
export function isRecurringBillTransaction(txn: TimelineCalendarTransaction): boolean {
  if (txn.is_transfer) return false;
  if (parseAmount(txn.amount) >= 0) return false;

  const source = String(txn.source ?? "").toLowerCase();
  const kind = String(txn.kind ?? "").toLowerCase();
  if (parseRuleIdFromTimelineTxn(txn) != null) return true;
  if (source.includes("rule")) return true;
  if (kind.includes("bill") || kind.includes("project") || kind.includes("recurring")) return true;
  return false;
}

export function matchBillOccurrence(
  items: BillChecklistItem[],
  day: TimelineCalendarDay,
  txn: TimelineCalendarTransaction
): BillChecklistItem | null {
  const ruleId = parseRuleIdFromTimelineTxn(txn);
  const txnId = typeof txn.id === "number" ? txn.id : null;
  const normalizedDescription = txn.description.trim().toLowerCase();
  const amount = Math.abs(parseAmount(txn.amount));

  const exact = items.find((item) => {
    if (ruleId != null && item.rule_id === ruleId) return true;
    if (txnId != null && (item.transaction_id === txnId || item.matched_transaction_id === txnId)) {
      return true;
    }
    return false;
  });
  if (exact) return exact;

  return (
    items.find((item) => {
      const byName = item.name.trim().toLowerCase() === normalizedDescription;
      const byDate = item.due_date === day.date;
      const byAmount = Math.abs(parseAmount(item.amount)) === amount;
      return byName && (byDate || byAmount);
    }) ?? null
  );
}
