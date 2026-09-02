import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  spendingTargetProgressPercent,
  sortBudgetRows,
  parseOptionalMetricAmount,
} from "@/features/budget/spendingTargetDisplay";
import { shiftPeriodAnchor, currentPeriodAnchor, formatPeriodLabel } from "@/features/budget/periodUtils";
import { budgetQueryKeys } from "@/features/budget/queryKeys";
import type { SpendingTargetMetrics } from "@budget-app/shared";

const dir = dirname(fileURLToPath(import.meta.url));
const displaySrc = readFileSync(join(dir, "spendingTargetDisplay.ts"), "utf8");
const useBudgetSrc = readFileSync(join(dir, "useBudgetData.ts"), "utf8");
const budgetScreen = readFileSync(join(dir, "BudgetScreen.tsx"), "utf8");
const limitsScreen = readFileSync(join(dir, "SpendingLimitsScreen.tsx"), "utf8");
const detailScreen = readFileSync(join(dir, "BudgetCategoryDetailScreen.tsx"), "utf8");
const formScreen = readFileSync(join(dir, "SpendingLimitFormScreen.tsx"), "utf8");

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
    committed_amount: "250",
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
  it("uses backend percent_used for progress (visual clamp only)", () => {
    expect(spendingTargetProgressPercent(mockMetrics())).toBe(50);
    expect(spendingTargetProgressPercent(mockMetrics({ percent_used: "120" }))).toBe(100);
  });

  it("does not calculate committed amount or remaining from amounts", () => {
    expect(displaySrc).not.toMatch(/spendingTargetCommittedAmount/);
    expect(displaySrc).not.toMatch(/spendingTargetsRemainingFromSummary/);
    expect(displaySrc).not.toMatch(/spent_so_far \+ scheduled/);
    expect(displaySrc).not.toMatch(/total_monthly_targets/);
  });

  it("flags over-limit status using backend status then percent_used", () => {
    const rows = [
      {
        target: { name: "A", category: { name: "A" } },
        metrics: mockMetrics({ status: "within_target", target_id: 1 }),
      },
      {
        target: { name: "B", category: { name: "B" } },
        metrics: mockMetrics({
          status: "above_target",
          target_id: 2,
          spent_so_far: "600",
          percent_used: "120",
        }),
      },
    ];
    const sorted = sortBudgetRows(rows, "over");
    expect(sorted[0].metrics.status).toBe("above_target");
  });

  it("sorts safely when metric strings are malformed", () => {
    const rows = [
      {
        target: { name: "A", category: { name: "A" } },
        metrics: mockMetrics({ target_id: 1, percent_used: "not-a-number", spent_so_far: "bad" }),
      },
      {
        target: { name: "B", category: { name: "B" } },
        metrics: mockMetrics({ target_id: 2, percent_used: "80", spent_so_far: "100" }),
      },
    ];
    const sorted = sortBudgetRows(rows, "utilization");
    expect(sorted[0].metrics.target_id).toBe(2);
    expect(parseOptionalMetricAmount("bad")).toBeNull();
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

describe("Budget pull refresh and period integrity", () => {
  it("uses explicit pullRefreshing, not passive isFetching", () => {
    expect(budgetScreen).toMatch(/pullRefreshing/);
    expect(budgetScreen).not.toMatch(/isFetching && !isLoading/);
    expect(limitsScreen).toMatch(/pullRefreshing/);
    expect(limitsScreen).not.toMatch(/isFetching && !isLoading/);
  });

  it("awaits summary and targets on refresh", () => {
    expect(useBudgetSrc).toMatch(/Promise\.all/);
    expect(useBudgetSrc).toMatch(/summaryQuery\.refetch/);
    expect(useBudgetSrc).toMatch(/targetsQuery\.refetch/);
  });

  it("does not mislabel previous-period data as current", () => {
    expect(useBudgetSrc).toMatch(/dataMatchesPeriod/);
    expect(useBudgetSrc).toMatch(/keepPreviousData/);
    expect(budgetScreen).toMatch(/Updating/);
  });
});

describe("Budget detail retrieve", () => {
  it("fetches a single target via getSpendingTarget, not the full list", () => {
    expect(detailScreen).toMatch(/getSpendingTarget/);
    expect(detailScreen).not.toMatch(/listSpendingTargets/);
  });
});

describe("Spending limit form threshold", () => {
  it("omits client production warning threshold literal", () => {
    expect(formScreen).not.toMatch(/useState\("80"\)/);
    expect(formScreen).not.toMatch(/\|\| "80"/);
    expect(formScreen).toMatch(/getSpendingTarget/);
    expect(formScreen).toMatch(/Leave blank for server default/);
  });
});
