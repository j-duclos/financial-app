import { describe, expect, it } from "vitest";
import type { SpendingTargetMetrics } from "@budget-app/shared";
import {
  SPENDING_TARGET_STATUS_LABELS,
  spendingTargetCommittedAmount,
  spendingTargetProgressPercent,
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
  it("uses spending limits route", () => {
    expect(SPENDING_GOALS_PATH).toBe("/spending-goals");
    expect(SPENDING_TARGETS_PATH).toBe("/spending-goals");
  });

  it("labels above limit status", () => {
    expect(SPENDING_TARGET_STATUS_LABELS.above_target).toBe("Above limit");
  });

  it("groceries with no scheduled uses spent only for progress", () => {
    expect(spendingTargetCommittedAmount(metrics)).toBeCloseTo(177.13, 2);
    expect(spendingTargetProgressPercent(metrics)).toBeCloseTo(32.2, 1);
  });

  it("includes scheduled amounts in committed total", () => {
    const withScheduled = { ...metrics, scheduled_in_period: "620", spent_so_far: "520" };
    expect(spendingTargetCommittedAmount(withScheduled)).toBeCloseTo(1140, 2);
  });
});
