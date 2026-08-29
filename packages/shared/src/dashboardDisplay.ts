import type {
  DashboardLowestProjectedCash,
  DashboardSummary,
  DashboardSummaryFast,
  DashboardTopSummary,
  ExtendedCashRisk,
  ExtendedCashRiskResponse,
} from "./types";
import { formatCurrency } from "./utils";
import { formatShortMonthDay } from "./dateDisplay";

/** Prefer `top_summary`; fall back to legacy snapshot fields when needed. */
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

export function lowestProjectedCashSubtitle(metric: DashboardLowestProjectedCash): string {
  const dateLabel = metric.date ? formatShortMonthDay(metric.date) : "—";
  const account = metric.account_name?.trim() || "Account";
  return `${account} · ${dateLabel}`;
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

export function isLookingAheadVisible(
  payload: ExtendedCashRiskResponse | undefined,
  forecastDays: number
): payload is ExtendedCashRiskResponse & { risk: ExtendedCashRisk } {
  const risk = payload?.risk;
  if (!risk) return false;
  return risk.days_from_as_of > forecastDays;
}

function daysFromNowLabel(days: number): string {
  if (days === 1) return "1 day from now";
  return `${days} days from now`;
}

export function lookingAheadMessage(risk: ExtendedCashRisk): string {
  const when = `${formatShortMonthDay(risk.first_negative_date)}, ${daysFromNowLabel(risk.days_from_as_of)}`;
  const extras = risk.additional_accounts ?? [];
  if (extras.length === 0) {
    return `${risk.account_name} is projected to fall below $0 on ${when}.`;
  }
  if (extras.length === 1) {
    return `${risk.account_name} and ${extras[0].account_name} are projected to fall below $0 on ${when}.`;
  }
  return `${risk.account_name} and ${extras.length} other accounts are projected to fall below $0 on ${when}.`;
}
