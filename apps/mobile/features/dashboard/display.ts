import type {
  DashboardLowestProjectedCash,
  DashboardSummary,
  DashboardSummaryFast,
  DashboardTopSummary,
  ExtendedCashRisk,
  ExtendedCashRiskResponse,
} from "@budget-app/shared";
import { formatCurrency, normalizeSeverity } from "@budget-app/shared";

/** Format ISO date as "Jul 22" (matches web dateDisplay). */
export function formatShortMonthDay(isoDate: string | null | undefined): string {
  if (isoDate == null || isoDate === "") return "—";
  const datePart = isoDate.trim().slice(0, 10);
  const d = new Date(`${datePart}T12:00:00`);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

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

export function lookingAheadMessage(risk: ExtendedCashRisk): string {
  const daysLabel =
    risk.days_from_as_of === 1 ? "1 day from now" : `${risk.days_from_as_of} days from now`;
  const when = `${formatShortMonthDay(risk.first_negative_date)}, ${daysLabel}`;
  const extras = risk.additional_accounts ?? [];
  if (extras.length === 0) {
    return `${risk.account_name} is projected to fall below $0 on ${when}.`;
  }
  if (extras.length === 1) {
    return `${risk.account_name} and ${extras[0].account_name} are projected to fall below $0 on ${when}.`;
  }
  return `${risk.account_name} and ${extras.length} other accounts are projected to fall below $0 on ${when}.`;
}

export function attentionItemsLimited<T>(items: T[], limit = 3): T[] {
  return items.slice(0, limit);
}

export function isDashboardOnboarding(
  summary: Pick<DashboardSummaryFast, "attention" | "recommendations" | "top_summary"> | undefined
): boolean {
  if (!summary) return false;
  const top = summary.top_summary;
  const liquid = parseFloat(top?.liquid_cash ?? "0");
  const credit = parseFloat(top?.available_credit ?? "0");
  const noMoney = (!Number.isFinite(liquid) || liquid === 0) && (!Number.isFinite(credit) || credit === 0);
  const noAttention = (summary.attention?.length ?? 0) === 0;
  const noRecs = (summary.recommendations?.length ?? 0) === 0;
  return noMoney && noAttention && noRecs;
}

export function attentionStatusTone(
  status: "healthy" | "watch" | "risk" | "critical"
): "positive" | "warning" | "critical" | "neutral" {
  switch (normalizeSeverity(status)) {
    case "critical":
      return "critical";
    case "at_risk":
      return "warning";
    case "watch":
      return "warning";
    case "healthy":
      return "positive";
    default:
      return "neutral";
  }
}

export function attentionStatusLabel(status: "healthy" | "watch" | "risk" | "critical"): string {
  switch (status) {
    case "critical":
      return "Critical";
    case "risk":
      return "Risk";
    case "watch":
      return "Watch";
    case "healthy":
      return "Healthy";
    default:
      return status;
  }
}

/** Dashboard attention card issue line — compact colon form from README mock. */
export function attentionPrimaryIssueDisplay(reason: string | null | undefined): string | null {
  const text = reason?.trim();
  if (!text) return null;
  const projected = text.match(/^Projected negative\s+(.+)$/i);
  if (projected) return `Projected negative: ${projected[1]}`;
  const utilization = text.match(/^Utilization is\s+(.+)$/i);
  if (utilization) return `Utilization: ${utilization[1]}`;
  return text;
}
