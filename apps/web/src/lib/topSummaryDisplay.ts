import type { DashboardSummary, DashboardTopSummary } from "@budget-app/shared";
import { formatCurrency } from "@budget-app/shared";
import { formatHealthRiskDate } from "./accountHealthDisplay";
import { riskStatusClass, riskStatusLabel } from "./safeToSpendLabels";

export function topSummaryFromDashboard(summary: DashboardSummary): DashboardTopSummary {
  if (summary.top_summary) return summary.top_summary;
  const snap = summary.snapshot;
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

export function safeToSpendRiskSubtitle(
  safeToSpend: DashboardSummary["safe_to_spend"]
): string | null {
  const amount = parseFloat(safeToSpend.amount);
  const next = safeToSpend.next_issue;
  const dateLabel = next?.risk_date ? formatHealthRiskDate(next.risk_date) : null;

  if (amount < 0) {
    return dateLabel ? `Negative by ${dateLabel}` : "Negative in forecast window";
  }
  if (safeToSpend.status === "critical") {
    return dateLabel ? `Forecast risk by ${dateLabel}` : "Forecast risk in window";
  }
  if (safeToSpend.status === "risk" || safeToSpend.status === "watch") {
    return dateLabel ? `Low point on ${dateLabel}` : "Elevated forecast risk";
  }
  return null;
}

export function safeToSpendHealthySubtitle(windowDays: number): string {
  return `Spendable before projected risk (${windowDays}-day view)`;
}

export function safeToSpendAmountClass(
  safeToSpend: DashboardSummary["safe_to_spend"]
): string {
  const amount = parseFloat(safeToSpend.amount);
  if (safeToSpend.status === "critical" || amount < 0) return "text-red-700";
  if (safeToSpend.status === "watch") return "text-amber-800";
  return "text-emerald-800";
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
