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

/** Dashboard hero value — actual projected balance (not cushion wording). */
export function lowestProjectedCashDisplayValue(amount: string): string {
  return formatCurrency(amount);
}

export function lowestProjectedCashLabel(isNegative: boolean): string {
  return isNegative ? "Projected Cash Shortfall" : "Lowest Projected Cash";
}

export function lowestProjectedCashSubtitle(
  lowest: DashboardLowestProjectedCash
): string {
  const dateLabel = formatHealthRiskDate(lowest.date);
  const account = lowest.account_name?.trim() || "Account";
  return `${account} · ${dateLabel}`;
}

export function lowestProjectedCashAmountClass(isNegative: boolean): string {
  return isNegative ? "text-red-700" : "text-emerald-800";
}

/** @deprecated Dashboard top bar uses lowestProjectedCash* helpers. */
export function safeToSpendDisplayValue(amount: string): string {
  const value = parseFloat(amount);
  if (Number.isFinite(value) && value < 0) {
    return `You are short by ${formatCurrency(String(Math.abs(value)))}`;
  }
  return formatCurrency(amount);
}

export function safeToSpendRiskSubtitle(
  safeToSpend: DashboardSummary["safe_to_spend"]
): string | null {
  const amount = parseFloat(safeToSpend.amount);
  const next = safeToSpend.next_issue;
  const dateLabel = next?.risk_date ? formatHealthRiskDate(next.risk_date) : null;

  if (amount < 0) {
    return dateLabel
      ? `Short by ${dateLabel} after bills, buffers, and reserved savings`
      : "Shortfall after bills, buffers, and reserved savings";
  }
  if (safeToSpend.status === "critical") {
    return dateLabel ? `Earliest issue: ${dateLabel}` : "Issue projected in forecast window";
  }
  if (safeToSpend.status === "risk" || safeToSpend.status === "watch") {
    return dateLabel ? `Earliest issue: ${dateLabel}` : "Tight headroom in forecast window";
  }
  return null;
}

export function safeToSpendHealthySubtitle(windowDays: number): string {
  return `Headroom after bills, buffers, and reserved savings (${windowDays}-day view)`;
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
