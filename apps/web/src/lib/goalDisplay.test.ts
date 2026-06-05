import { describe, expect, it } from "vitest";
import type { DashboardGoalSummary } from "@budget-app/shared";
import {
  GOAL_TYPE_OPTIONS,
  formatGoalProgressLine,
  goalContributionHint,
  goalHealthLabel,
  isDebtGoalType,
  dashboardGoalPercent,
  parseProgressPercent,
  progressBarBlocks,
} from "./goalDisplay";

function dashGoal(overrides: Partial<DashboardGoalSummary> = {}): DashboardGoalSummary {
  return {
    id: 1,
    name: "Emergency Fund",
    goal_type: "emergency_fund",
    current_amount: "4300",
    target_amount: "10000",
    remaining_amount: "5700",
    progress_percent: "43",
    projected_completion_date: "2027-03-01",
    on_track_status: "on_track",
    recommended_monthly_contribution: null,
    priority: 1,
    status: "active",
    target_date: null,
    linked_account_name: "Emergency",
    is_debt_goal: false,
    ...overrides,
  };
}

describe("goalDisplay", () => {
  it("detects debt goal type", () => {
    expect(isDebtGoalType("debt_payoff")).toBe(true);
    expect(isDebtGoalType("savings")).toBe(false);
  });

  it("lists primary financial goal types for the form", () => {
    const values = GOAL_TYPE_OPTIONS.map((o) => o.value);
    expect(values).toContain("emergency");
    expect(values).toContain("debt_payoff");
  });

  it("formats savings progress line", () => {
    expect(formatGoalProgressLine(dashGoal())).toContain("4,300");
    expect(formatGoalProgressLine(dashGoal())).toContain("10,000");
  });

  it("formats debt progress line as owed", () => {
    const line = formatGoalProgressLine(
      dashGoal({
        is_debt_goal: true,
        linked_debt_balance: "1231.00",
        remaining_amount: "1231.00",
      })
    );
    expect(line).toMatch(/owed/i);
  });

  it("parses progress percent", () => {
    expect(parseProgressPercent("43.5")).toBe(43.5);
    expect(parseProgressPercent("150")).toBe(100);
  });

  it("rounds dashboard goal percent", () => {
    expect(dashboardGoalPercent("12.39")).toBe(12);
  });

  it("builds progress bar blocks", () => {
    expect(progressBarBlocks(50, 4)).toBe("██░░");
  });

  it("maps goal health labels", () => {
    expect(goalHealthLabel("watch")).toBe("Watch");
    expect(goalHealthLabel("behind")).toBe("Behind");
  });

  it("shows contribution hint when behind", () => {
    const hint = goalContributionHint(
      dashGoal({
        on_track_status: "behind",
        recommended_monthly_contribution: "650.00",
        target_date: "2026-12-01",
      })
    );
    expect(hint).toMatch(/650/);
    expect(hint).toMatch(/mo/i);
  });
});
