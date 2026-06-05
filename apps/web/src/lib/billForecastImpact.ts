import { formatCurrency } from "@budget-app/shared";
import type { TimelineCalendarDay, TimelineCalendarTransaction } from "@budget-app/shared";
import { formatDueDateShort } from "./billsDisplay";
import { formatAccountProjectedBalance } from "./dayHeatDisplay";
import { determineRiskContributionLabels, parseAmount } from "./timelineCalendarUtils";

export type BillForecastImpact = {
  tone: "healthy" | "risk";
  headline: string;
  details: string[];
};

function txnDescriptionKey(txn: TimelineCalendarTransaction): string {
  return txn.description.trim().toLowerCase();
}

function dayMatchesTxnLowest(day: TimelineCalendarDay, txn: TimelineCalendarTransaction): boolean {
  const desc = txnDescriptionKey(txn);
  const lowestDesc = (day.lowest_projected_balance_after_description ?? "").trim().toLowerCase();
  return Boolean(desc && lowestDesc && desc === lowestDesc);
}

/** Scan horizon for the day this payment triggers the lowest projected balance. */
export function findBillRiskDay(
  txn: TimelineCalendarTransaction,
  calendarDays: TimelineCalendarDay[]
): TimelineCalendarDay | null {
  for (const day of calendarDays) {
    if (dayMatchesTxnLowest(day, txn)) return day;
  }
  return null;
}

export function formatBillForecastImpact(
  day: TimelineCalendarDay,
  txn: TimelineCalendarTransaction,
  calendarDays: TimelineCalendarDay[] = []
): BillForecastImpact {
  const riskDay = findBillRiskDay(txn, calendarDays) ?? (dayMatchesTxnLowest(day, txn) ? day : null);
  const accountName =
    riskDay?.lowest_projected_balance_account_name ??
    riskDay?.affected_account_name ??
    txn.account_name;
  const balance = riskDay?.lowest_projected_balance ?? day.lowest_projected_balance;
  const riskDate = riskDay?.lowest_projected_balance_date ?? riskDay?.date ?? day.date;
  const parsedBalance = balance != null ? parseAmount(balance) : null;
  const labels = determineRiskContributionLabels(riskDay ?? day, txn);

  if (riskDay && parsedBalance != null && parsedBalance < 0) {
    return {
      tone: "risk",
      headline: "Lowest projected balance occurs after this payment:",
      details: [
        formatAccountProjectedBalance(accountName, balance),
        riskDate !== day.date
          ? `Projected on ${formatDueDateShort(riskDate)}`
          : `On ${formatDueDateShort(day.date)}`,
      ],
    };
  }

  if (labels.length > 0 && parsedBalance != null) {
    const dateLabel = formatDueDateShort(riskDate);
    if (parsedBalance < 0) {
      return {
        tone: "risk",
        headline: `This payment contributes to ${accountName} reaching ${formatCurrency(balance)} on ${dateLabel}.`,
        details: labels.map((label) => label),
      };
    }
    return {
      tone: "risk",
      headline: `This payment contributes to projected risk on ${dateLabel}.`,
      details: labels,
    };
  }

  return {
    tone: "healthy",
    headline: "This payment does not create a projected risk.",
    details: [],
  };
}
