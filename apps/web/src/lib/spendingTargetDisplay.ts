import type {
  SpendingTargetMetrics,
  SpendingTargetStatus,
  SpendingTargetType,
} from "@budget-app/shared";

export const SPENDING_GOALS_PATH = "/spending-goals";

/** CTA on recommendation cards that link to the spending limits page. */
export const VIEW_SPENDING_LIMITS_LABEL = "View spending limits";

/** @deprecated use VIEW_SPENDING_LIMITS_LABEL */
export const VIEW_SPENDING_GOALS_LABEL = VIEW_SPENDING_LIMITS_LABEL;

/** @deprecated use SPENDING_GOALS_PATH */
export const SPENDING_TARGETS_PATH = SPENDING_GOALS_PATH;

export const SPENDING_TARGET_STATUS_LABELS: Record<SpendingTargetStatus, string> = {
  within_target: "Within limit",
  approaching_target: "Approaching limit",
  above_target: "Above limit",
  risky: "At risk",
};

export const SPENDING_TARGET_TYPE_LABELS: Record<SpendingTargetType, string> = {
  fixed: "Fixed / scheduled",
  variable: "Variable",
};

export function spendingTargetStatusClass(status: SpendingTargetStatus): string {
  switch (status) {
    case "risky":
      return "bg-red-100 text-red-800 border-red-200";
    case "above_target":
      return "bg-orange-100 text-orange-800 border-orange-200";
    case "approaching_target":
      return "bg-amber-100 text-amber-800 border-amber-200";
    default:
      return "bg-green-100 text-green-800 border-green-200";
  }
}

/** Spent plus known future scheduled amounts (used for status/progress only). */
export function spendingTargetCommittedAmount(metrics: SpendingTargetMetrics): number {
  const spent = parseFloat(metrics.spent_so_far ?? "0");
  const scheduled = parseFloat(metrics.scheduled_in_period ?? "0");
  if (!Number.isFinite(spent)) return 0;
  if (!Number.isFinite(scheduled)) return spent;
  return spent + scheduled;
}

export function spendingTargetProgressPercent(metrics: SpendingTargetMetrics): number {
  const committed = spendingTargetCommittedAmount(metrics);
  const target = parseFloat(metrics.target_amount);
  if (!Number.isFinite(committed) || !Number.isFinite(target) || target <= 0) {
    const n = parseFloat(metrics.percent_used);
    return Number.isFinite(n) ? Math.min(100, Math.max(0, n)) : 0;
  }
  return Math.min(100, Math.max(0, (committed / target) * 100));
}

export function spendingTargetPeriodLabel(period: string): string {
  switch (period) {
    case "weekly":
      return "week";
    case "quarterly":
      return "quarter";
    case "yearly":
      return "year";
    default:
      return "month";
  }
}
