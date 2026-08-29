import type { DashboardLowestProjectedCash } from "@budget-app/shared";
import {
  availableCreditSubtitle,
  creditUtilizationSummary,
  lowestProjectedCashDisplayValue,
  lowestProjectedCashSubtitle,
  topSummaryFromDashboard,
} from "@budget-app/shared";
import { riskStatusClass, riskStatusLabel } from "./safeToSpendLabels";

export {
  availableCreditSubtitle,
  creditUtilizationSummary,
  lowestProjectedCashDisplayValue,
  lowestProjectedCashSubtitle,
  topSummaryFromDashboard,
};

/** Web-only Tailwind class for forecast balance emphasis. */
export function lowestProjectedCashAmountClass(
  metric: DashboardLowestProjectedCash
): string {
  const amount = parseFloat(metric.amount);
  return Number.isFinite(amount) && amount < 0 ? "text-red-700" : "text-emerald-800";
}

export { riskStatusClass, riskStatusLabel };
