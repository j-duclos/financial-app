import type { SpendingTarget, SpendingTargetMetrics } from "@budget-app/shared";

export type BudgetSortKey = "utilization" | "spent" | "remaining" | "name" | "over";

export type BudgetCategoryRow = {
  target: SpendingTarget;
  metrics: SpendingTargetMetrics;
};

export type BudgetPeriodAnchor = {
  /** ISO date used as backend anchor for period bounds. */
  anchor: string;
  /** YYYY-MM for query cache grouping. */
  monthKey: string;
};
