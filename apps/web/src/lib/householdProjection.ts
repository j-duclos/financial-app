import { formatCurrency } from "@budget-app/shared";
import type { Account, TimelineRow } from "@budget-app/shared";
import { formatDateDisplay, todayStr } from "../components/transactions/transactionsLedgerUtils";

export type HouseholdProjectionLine = { key: string; text: string };

/** Default projection window on Accounts (matches Transactions page 3-month time range). */
export const HOUSEHOLD_PROJECTION_MONTHS = 3;

export function buildHouseholdProjectionLines(
  timeline: TimelineRow[],
  accounts: Account[],
  today: string = todayStr()
): HouseholdProjectionLine[] {
  if (!timeline.length || !accounts.length) return [];
  const lines: HouseholdProjectionLine[] = [];
  for (const acc of accounts) {
    const cur = acc.currency ?? "USD";
    const accRows = timeline
      .filter((r) => Number(r.account_id) === Number(acc.id) && r.date > today)
      .sort((a, b) => a.date.localeCompare(b.date));
    if (accRows.length === 0) continue;
    const isCredit = String(acc.account_type ?? "").toUpperCase() === "CREDIT";
    let minBal = Infinity;
    let maxBal = -Infinity;
    let minRow = accRows[0];
    let maxRow = accRows[0];
    for (const r of accRows) {
      const bal = parseFloat(r.running_balance);
      if (bal < minBal) {
        minBal = bal;
        minRow = r;
      }
      if (bal > maxBal) {
        maxBal = bal;
        maxRow = r;
      }
    }
    if (isCredit) {
      lines.push({
        key: `${acc.id}-credit-high`,
        text: `${acc.name}: Highest projected in this time range: ${formatCurrency(-minBal, cur)} on ${formatDateDisplay(minRow.date)}`,
      });
      lines.push({
        key: `${acc.id}-credit-low`,
        text: `${acc.name}: Lowest projected in this time range: ${formatCurrency(-maxBal, cur)} on ${formatDateDisplay(maxRow.date)}`,
      });
    } else {
      lines.push({
        key: `${acc.id}-bank-low`,
        text: `${acc.name}: Lowest projected in this time range: ${formatCurrency(minBal, cur)} on ${formatDateDisplay(minRow.date)}`,
      });
    }
  }
  return lines;
}
