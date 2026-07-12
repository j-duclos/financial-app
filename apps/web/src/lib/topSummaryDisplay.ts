import type {
  DashboardLowestProjectedCash,
  DashboardSummary,
  DashboardSummaryFast,
  DashboardTopSummary,
} from "@budget-app/shared";
import { formatCurrency } from "@budget-app/shared";
import { formatHealthRiskDate } from "./accountHealthDisplay";
import { riskStatusClass, riskStatusLabel } from "./safeToSpendLabels";

export function topSummaryFromDashboard(
  summary: Pick<DashboardSummaryFast, "top_summary"> &
    Partial<Pick<DashboardSummary, "snapshot">>
): DashboardTopSummary {
  if (summary.top_summary) return summary.top_summary;
  const snap = summary.snapshot;
  if (!snap) {
    return {
      liquid_cash: "0",
      available_credit: "0",
      total_credit_limit: null,
      credit_utilization: null,
      net_position: "0",
    };
  }
  const cash = parseFloat(snap.cash || "0");
  const savings = parseFloat(snap.savings || "0");
  return {
    liquid_cash: String(cash + savings),
    available_credit: "0",
    total_credit_limit: null,
    credit_utilization: snap.utilization ?? snap.credit_utilization ?? null,
    net_position: snap.net_position,
  };
}

export function lowestProjectedCashDisplayValue(amount: string): string {
  return formatCurrency(amount);
}

export function lowestProjectedCashSubtitle(
  metric: DashboardLowestProjectedCash
): string {
  const dateLabel = metric.date ? formatHealthRiskDate(metric.date) : "—";
  const account = metric.account_name?.trim() || "Account";
  return `${account} · ${dateLabel}`;
}

export function lowestProjectedCashAmountClass(
  metric: DashboardLowestProjectedCash
): string {
  const amount = parseFloat(metric.amount);
  return Number.isFinite(amount) && amount < 0 ? "text-red-700" : "text-emerald-800";
}

export function creditUtilizationSummary(util: string | null | undefined): string | null {
  if (util == null || util === "") return null;
  const n = parseFloat(util);
  if (!Number.isFinite(n)) return null;
  return `${n.toFixed(0)}% of limit in use`;
}

export function availableCreditSubtitle(
  util: string | null | undefined,
  totalLimit: string | null | undefined
): string {
  const utilLine = creditUtilizationSummary(util);
  const limitNum = totalLimit != null && totalLimit !== "" ? parseFloat(totalLimit) : NaN;
  const limitLine =
    Number.isFinite(limitNum) && limitNum > 0
      ? `Of ${formatCurrency(String(limitNum))} total limit`
      : null;
  if (limitLine && utilLine) return `${limitLine} · ${utilLine}`;
  if (limitLine) return limitLine;
  if (utilLine) return `${utilLine} · Across active credit accounts`;
  return "Across active credit accounts";
}

export { riskStatusClass, riskStatusLabel };
