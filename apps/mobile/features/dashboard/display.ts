import type { DashboardSummaryFast } from "@budget-app/shared";
import { normalizeSeverity } from "@budget-app/shared";

export {
  availableCreditSubtitle,
  creditUtilizationSummary,
  isLookingAheadVisible,
  lookingAheadMessage,
  lowestProjectedCashDisplayValue,
  lowestProjectedCashSubtitle,
  topSummaryFromDashboard,
} from "@budget-app/shared";

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
  const noMoney =
    (!Number.isFinite(liquid) || liquid === 0) && (!Number.isFinite(credit) || credit === 0);
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
