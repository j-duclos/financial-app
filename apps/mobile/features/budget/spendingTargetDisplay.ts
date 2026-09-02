import type { SpendingTargetMetrics, SpendingTargetStatus } from "@budget-app/shared";

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

export const SPENDING_TARGET_STATUS_LABELS: Record<SpendingTargetStatus, string> = {
  within_target: "Within limit",
  approaching_target: "Approaching limit",
  above_target: "Over limit",
  risky: "At risk",
};

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

export function spendingTargetStatusTone(
  status: SpendingTargetStatus
): "positive" | "warning" | "critical" | "neutral" {
  switch (status) {
    case "above_target":
    case "risky":
      return "critical";
    case "approaching_target":
      return "warning";
    case "within_target":
      return "positive";
    default:
      return "neutral";
  }
}

export function spendingTargetPeriodLabel(period: string): string {
  switch (period) {
    case "weekly":
      return "Weekly";
    case "quarterly":
      return "Quarterly";
    case "yearly":
      return "Yearly";
    default:
      return "Monthly";
  }
}

function compareOptionalDesc(a: string | null | undefined, b: string | null | undefined): number {
  const na = parseOptionalMetricAmount(a);
  const nb = parseOptionalMetricAmount(b);
  if (na == null && nb == null) return 0;
  if (na == null) return 1;
  if (nb == null) return -1;
  return nb - na;
}

function compareOptionalAsc(a: string | null | undefined, b: string | null | undefined): number {
  const na = parseOptionalMetricAmount(a);
  const nb = parseOptionalMetricAmount(b);
  if (na == null && nb == null) return 0;
  if (na == null) return 1;
  if (nb == null) return -1;
  return na - nb;
}

export function sortBudgetRows<
  T extends { metrics: SpendingTargetMetrics; target: { name: string; category: { name: string } } },
>(rows: T[], sortKey: import("./types").BudgetSortKey): T[] {
  const sorted = [...rows];
  sorted.sort((a, b) => {
    switch (sortKey) {
      case "name":
        return (a.target.name || a.metrics.category_name).localeCompare(
          b.target.name || b.metrics.category_name
        );
      case "spent":
        return compareOptionalDesc(a.metrics.spent_so_far, b.metrics.spent_so_far);
      case "remaining":
        return compareOptionalAsc(a.metrics.remaining_to_target, b.metrics.remaining_to_target);
      case "over": {
        const rank = (s: SpendingTargetStatus) =>
          s === "above_target" || s === "risky" ? 0 : s === "approaching_target" ? 1 : 2;
        const diff = rank(a.metrics.status) - rank(b.metrics.status);
        if (diff !== 0) return diff;
        return compareOptionalDesc(a.metrics.percent_used, b.metrics.percent_used);
      }
      case "utilization":
      default:
        return compareOptionalDesc(a.metrics.percent_used, b.metrics.percent_used);
    }
  });
  return sorted;
}
