import { describe, expect, it } from "vitest";
import type { FinancialGoal } from "@budget-app/shared";
import {
  activeGoalsForDashboard,
  goalsForDashboard,
  goalsDashboardGridClass,
  topActiveGoalsForDashboard,
} from "./goalsDashboard";

function goal(status: FinancialGoal["status"], id = 1, name = "Test"): FinancialGoal {
  return {
    id,
    household: 1,
    name,
    goal_type: "house",
    target_amount: "1000",
    current_amount: "100",
    target_date: null,
    linked_account: null,
    linked_credit_account: null,
    monthly_contribution: "0",
    contribution_rule: null,
    priority: "medium",
    status,
    notes: "",
    created_at: "",
    updated_at: "",
    completed_at: null,
    remaining_amount: "900",
    progress_percent: "10",
    projected_completion_date: null,
    on_track_status: "on_track",
    recommended_monthly_contribution: null,
    is_debt_goal: false,
    goal_health: "on_track",
    monthly_required: null,
    current_contribution_rate: null,
    forecast_gap: null,
    funding_account: null,
    milestones: [],
  };
}

describe("goalsForDashboard", () => {
  it("includes every status and sorts active before completed", () => {
    const sorted = goalsForDashboard([
      goal("archived", 4, "D"),
      goal("completed", 3, "C"),
      goal("paused", 2, "B"),
      goal("active", 1, "A"),
    ]);
    expect(sorted.map((g) => g.id)).toEqual([1, 2, 3, 4]);
  });

  it("sorts by priority then name within the same status", () => {
    const sorted = goalsForDashboard([
      goal("active", 2, "Z"),
      { ...goal("active", 1, "A"), priority: 1 },
      { ...goal("active", 3, "M"), priority: 5 },
    ]);
    expect(sorted.map((g) => g.id)).toEqual([1, 2, 3]);
  });
});

describe("goalsDashboardGridClass", () => {
  it("uses 1, 2, or 3 columns based on goal count", () => {
    expect(goalsDashboardGridClass(1)).toContain("grid-cols-1");
    expect(goalsDashboardGridClass(1)).not.toContain("grid-cols-2");
    expect(goalsDashboardGridClass(2)).toContain("sm:grid-cols-2");
    expect(goalsDashboardGridClass(3)).toContain("lg:grid-cols-3");
    expect(goalsDashboardGridClass(5)).toContain("lg:grid-cols-3");
  });
});

describe("topActiveGoalsForDashboard", () => {
  it("returns at most limit active goals", () => {
    const top = topActiveGoalsForDashboard(
      [
        { ...goal("active", 1), priority: 3 },
        { ...goal("active", 2), priority: 1 },
        { ...goal("active", 3), priority: 2 },
        { ...goal("active", 4), priority: 4 },
      ],
      3
    );
    expect(top.map((g) => g.id)).toEqual([2, 3, 1]);
  });
});

describe("activeGoalsForDashboard", () => {
  it("keeps only active and paused goals", () => {
    const filtered = activeGoalsForDashboard([
      goal("active", 1),
      goal("paused", 2),
      goal("completed", 3),
      goal("archived", 4),
    ]);
    expect(filtered.map((g) => g.id)).toEqual([1, 2]);
  });
});
