import { describe, expect, it } from "vitest";
import type { SpendingTargetMetrics } from "@budget-app/shared";
import { formatCurrency } from "@budget-app/shared";
import {
  SPENDING_TARGET_STATUS_LABELS,
  SPENDING_TARGET_TYPE_LABELS,
  SPENDING_TARGET_CARD_ROW_LABELS,
  spendingTargetCardRows,
  spendingTargetCommittedAmount,
  spendingTargetProgressPercent,
  spendingTargetsRemainingFromSummary,
  SPENDING_GOALS_PATH,
  SPENDING_TARGETS_PATH,
} from "./spendingTargetDisplay";

const metrics: SpendingTargetMetrics = {
  target_id: 1,
  category_id: 2,
  category_name: "Groceries",
  name: "Groceries",
  period: "monthly",
  target_type: "variable",
  forecast_method: "scheduled_only",
  period_start: "2026-05-01",
  period_end: "2026-05-31",
  target_amount: "550",
  spent_so_far: "177.13",
  scheduled_in_period: "0",
  forecast_amount: "177.13",
  remaining_to_target: "372.87",
  percent_used: "32.2",
  status: "within_target",
  recommendation: null,
  forecast_summary: null,
  forecast_impact: null,
  account_id: null,
  warning_threshold_percent: "80",
  hard_limit: false,
  active: true,
};

describe("spendingTargetDisplay", () => {
  it("uses spending limits route labeled as Budget", () => {
    expect(SPENDING_GOALS_PATH).toBe("/spending-goals");
    expect(SPENDING_TARGETS_PATH).toBe("/spending-goals");
  });

  it("labels above limit status", () => {
    expect(SPENDING_TARGET_STATUS_LABELS.above_target).toBe("Above limit");
    expect(SPENDING_TARGET_STATUS_LABELS.approaching_target).toBe("Approaching limit");
    expect(SPENDING_TARGET_STATUS_LABELS.within_target).toBe("Within limit");
  });

  it("labels spending types without changing behavior keys", () => {
    expect(SPENDING_TARGET_TYPE_LABELS.fixed).toBe("Fixed / scheduled");
    expect(SPENDING_TARGET_TYPE_LABELS.variable).toBe("Variable spending");
  });

  it("groceries with no scheduled uses spent only for progress", () => {
    expect(spendingTargetCommittedAmount(metrics)).toBeCloseTo(177.13, 2);
    expect(spendingTargetProgressPercent(metrics)).toBeCloseTo(32.2, 1);
  });

  it("includes scheduled amounts in committed total", () => {
    const withScheduled = { ...metrics, scheduled_in_period: "620", spent_so_far: "520" };
    expect(spendingTargetCommittedAmount(withScheduled)).toBeCloseTo(1140, 2);
  });

  it("includes known upcoming in progress even when nothing has posted", () => {
    const insurance: SpendingTargetMetrics = {
      ...metrics,
      category_name: "Auto Insurance",
      name: "Auto Insurance",
      target_amount: "404",
      spent_so_far: "0",
      scheduled_in_period: "403.43",
      remaining_to_target: "0.57",
      percent_used: "99.9",
      status: "approaching_target",
    };
    expect(spendingTargetCommittedAmount(insurance)).toBeCloseTo(403.43, 2);
    expect(spendingTargetProgressPercent(insurance)).toBeCloseTo(99.86, 1);
  });

  it("always shows Limit / Spent / Upcoming / Remaining, including $0.00 upcoming", () => {
    expect(SPENDING_TARGET_CARD_ROW_LABELS).toEqual(["Limit", "Spent", "Upcoming", "Remaining"]);
    const rows = spendingTargetCardRows(metrics);
    expect(rows.map((row) => row.label)).toEqual(["Limit", "Spent", "Upcoming", "Remaining"]);
    expect(formatCurrency(rows[2]!.amount)).toBe(formatCurrency("0"));
    const empty: SpendingTargetMetrics = {
      ...metrics,
      spent_so_far: "0",
      scheduled_in_period: "0",
      remaining_to_target: "550",
    };
    const emptyRows = spendingTargetCardRows(empty);
    expect(emptyRows).toHaveLength(4);
    expect(emptyRows[1]!.amount).toBe("0");
    expect(emptyRows[2]!.amount).toBe("0");
    expect(emptyRows[3]!.amount).toBe("550");
  });

  it("derives remaining category budget from summary totals", () => {
    expect(
      spendingTargetsRemainingFromSummary({
        total_monthly_targets: "1000",
        spent_so_far_total: "400",
        scheduled_in_period_total: "150",
      })
    ).toBeCloseTo(450, 2);
  });
});
