import { describe, expect, it } from "vitest";
import type { SpendingTargetMetrics } from "@budget-app/shared";
import { formatCurrency } from "@budget-app/shared";
import {
  SPENDING_TARGET_STATUS_LABELS,
  SPENDING_TARGET_TYPE_LABELS,
  SPENDING_TARGET_CARD_ROW_LABELS,
  spendingTargetCardRows,
  spendingTargetProgressPercent,
  parseOptionalMetricAmount,
  SPENDING_GOALS_PATH,
  SPENDING_TARGETS_PATH,
} from "./spendingTargetDisplay";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const displaySrc = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "spendingTargetDisplay.ts"),
  "utf8"
);

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
  committed_amount: "177.13",
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

  it("uses backend percent_used for progress (visual clamp only)", () => {
    expect(spendingTargetProgressPercent(metrics)).toBeCloseTo(32.2, 1);
    expect(spendingTargetProgressPercent({ ...metrics, percent_used: "150" })).toBe(100);
    expect(spendingTargetProgressPercent({ ...metrics, percent_used: "NaN" })).toBe(0);
  });

  it("does not recompute committed amount or remaining from component amounts", () => {
    expect(displaySrc).not.toMatch(/spent_so_far.*scheduled_in_period/);
    expect(displaySrc).not.toMatch(/total_monthly_targets\s*-/);
    expect(displaySrc).not.toMatch(/spendingTargetCommittedAmount/);
    expect(displaySrc).not.toMatch(/spendingTargetsRemainingFromSummary/);
  });

  it("contains no production hard-coded warning threshold", () => {
    expect(displaySrc).not.toMatch(/["']80["']/);
  });

  it("always shows Limit / Spent / Upcoming / Remaining, including $0.00 upcoming", () => {
    expect(SPENDING_TARGET_CARD_ROW_LABELS).toEqual(["Limit", "Spent", "Upcoming", "Remaining"]);
    const rows = spendingTargetCardRows(metrics);
    expect(rows.map((row) => row.label)).toEqual(["Limit", "Spent", "Upcoming", "Remaining"]);
    expect(formatCurrency(rows[2]!.amount)).toBe(formatCurrency("0"));
  });

  it("parses optional metrics without coercing garbage to zero", () => {
    expect(parseOptionalMetricAmount("12.5")).toBe(12.5);
    expect(parseOptionalMetricAmount("bad")).toBeNull();
    expect(parseOptionalMetricAmount(undefined)).toBeNull();
  });
});
