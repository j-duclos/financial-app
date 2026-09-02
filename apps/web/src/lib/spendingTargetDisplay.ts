import type {
  SpendingTargetMetrics,
  SpendingTargetStatus,
  SpendingTargetType,
} from "@budget-app/shared";

export const SPENDING_GOALS_PATH = "/spending-goals";

/** User-facing name for category spending limits. */
export const BUDGET_NAV_LABEL = "Budget";

/** CTA on recommendation cards that link to the Budget page. */
export const VIEW_BUDGET_LABEL = "View budget";

/** @deprecated use VIEW_BUDGET_LABEL */
export const VIEW_SPENDING_LIMITS_LABEL = VIEW_BUDGET_LABEL;

/** @deprecated use VIEW_BUDGET_LABEL */
export const VIEW_SPENDING_GOALS_LABEL = VIEW_BUDGET_LABEL;

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
  variable: "Variable spending",
};

/** Always-visible Budget card rows, including $0.00 Upcoming. */
export const SPENDING_TARGET_CARD_ROW_LABELS = ["Limit", "Spent", "Upcoming", "Remaining"] as const;

export type SpendingTargetCardRow = {
  label: (typeof SPENDING_TARGET_CARD_ROW_LABELS)[number];
  amount: string;
};

export function spendingTargetCardRows(metrics: SpendingTargetMetrics): SpendingTargetCardRow[] {
  return [
    { label: "Limit", amount: metrics.target_amount },
    { label: "Spent", amount: metrics.spent_so_far },
    { label: "Upcoming", amount: metrics.scheduled_in_period ?? "0" },
    { label: "Remaining", amount: metrics.remaining_to_target },
  ];
}

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

/** Parse optional backend money/percent strings without coercing garbage to 0. */
export function parseOptionalMetricAmount(value: string | null | undefined): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Visual progress bar width from backend percent_used.
 * Clamps to 0–100 for display only — does not recompute utilization.
 */
export function spendingTargetProgressPercent(metrics: SpendingTargetMetrics): number {
  const n = parseOptionalMetricAmount(metrics.percent_used);
  if (n == null) return 0;
  return Math.min(100, Math.max(0, n));
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
