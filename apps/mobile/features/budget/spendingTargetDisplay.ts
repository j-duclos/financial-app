import type {
  SpendingTargetMetrics,
  SpendingTargetStatus,
  SpendingTargetsSummary,
} from "@budget-app/shared";

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

export function spendingTargetsRemainingFromSummary(summary: SpendingTargetsSummary): number {
  const budget = parseFloat(summary.total_monthly_targets);
  const spent = parseFloat(summary.spent_so_far_total);
  const scheduled = parseFloat(summary.scheduled_in_period_total ?? "0");
  const safeBudget = Number.isFinite(budget) ? budget : 0;
  const safeSpent = Number.isFinite(spent) ? spent : 0;
  const safeScheduled = Number.isFinite(scheduled) ? scheduled : 0;
  return safeBudget - safeSpent - safeScheduled;
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

export function sortBudgetRows<T extends { metrics: SpendingTargetMetrics; target: { name: string; category: { name: string } } }>(
  rows: T[],
  sortKey: import("./types").BudgetSortKey
): T[] {
  const sorted = [...rows];
  sorted.sort((a, b) => {
    switch (sortKey) {
      case "name":
        return (a.target.name || a.metrics.category_name).localeCompare(
          b.target.name || b.metrics.category_name
        );
      case "spent":
        return parseFloat(b.metrics.spent_so_far) - parseFloat(a.metrics.spent_so_far);
      case "remaining":
        return parseFloat(a.metrics.remaining_to_target) - parseFloat(b.metrics.remaining_to_target);
      case "over": {
        const rank = (s: SpendingTargetStatus) =>
          s === "above_target" || s === "risky" ? 0 : s === "approaching_target" ? 1 : 2;
        const diff = rank(a.metrics.status) - rank(b.metrics.status);
        if (diff !== 0) return diff;
        return spendingTargetProgressPercent(b.metrics) - spendingTargetProgressPercent(a.metrics);
      }
      case "utilization":
      default:
        return spendingTargetProgressPercent(b.metrics) - spendingTargetProgressPercent(a.metrics);
    }
  });
  return sorted;
}
