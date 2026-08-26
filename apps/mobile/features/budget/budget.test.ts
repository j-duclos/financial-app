import { describe, expect, it } from "vitest";
import {
  spendingTargetProgressPercent,
  spendingTargetsRemainingFromSummary,
  sortBudgetRows,
} from "@/features/budget/spendingTargetDisplay";
import { shiftPeriodAnchor, currentPeriodAnchor, formatPeriodLabel } from "@/features/budget/periodUtils";
import { budgetQueryKeys } from "@/features/budget/queryKeys";
import type { SpendingTargetMetrics } from "@budget-app/shared";

function mockMetrics(overrides: Partial<SpendingTargetMetrics> = {}): SpendingTargetMetrics {
  return {
    target_id: 1,
    category_id: 5,
    category_name: "Groceries",
    name: "Groceries",
    period: "monthly",
    target_type: "variable",
    forecast_method: "scheduled_only",
    period_start: "2026-08-01",
    period_end: "2026-08-31",
    target_amount: "500",
    spent_so_far: "200",
    scheduled_in_period: "50",
    forecast_amount: "250",
    remaining_to_target: "250",
    percent_used: "50",
    status: "within_target",
    recommendation: null,
    forecast_summary: null,
    forecast_impact: null,
    account_id: null,
    warning_threshold_percent: "80",
    hard_limit: false,
    active: true,
    ...overrides,
  };
}

describe("spendingTargetDisplay", () => {
  it("computes progress from spent plus scheduled", () => {
    const pct = spendingTargetProgressPercent(mockMetrics());
    expect(pct).toBe(50);
  });

  it("flags over-limit status in sort", () => {
    const rows = [
      {
        target: { name: "A", category: { name: "A" } },
        metrics: mockMetrics({ status: "within_target", target_id: 1 }),
      },
      {
        target: { name: "B", category: { name: "B" } },
        metrics: mockMetrics({ status: "above_target", target_id: 2, spent_so_far: "600", percent_used: "120" }),
      },
    ];
    const sorted = sortBudgetRows(rows, "over");
    expect(sorted[0].metrics.status).toBe("above_target");
  });

  it("remaining from summary uses backend totals", () => {
    const remaining = spendingTargetsRemainingFromSummary({
      anchor_date: "2026-08-15",
      total_monthly_targets: "1000",
      spent_so_far_total: "400",
      scheduled_in_period_total: "100",
      above_target_count: 0,
      approaching_target_count: 0,
      targets: [],
    });
    expect(remaining).toBe(500);
  });
});

describe("periodUtils", () => {
  it("shifts period anchor by month", () => {
    const current = currentPeriodAnchor("2026-08-15");
    const prev = shiftPeriodAnchor(current, -1);
    expect(prev.monthKey).toBe("2026-07");
  });

  it("formats period label", () => {
    expect(formatPeriodLabel({ anchor: "2026-08-15", monthKey: "2026-08" })).toContain("2026");
  });
});

describe("budgetQueryKeys", () => {
  it("keys summary by household month and anchor", () => {
    expect(budgetQueryKeys.summary(1, "2026-08", "2026-08-15")).toEqual([
      "spending-targets-summary",
      1,
      "2026-08",
      "2026-08-15",
    ]);
  });
});
