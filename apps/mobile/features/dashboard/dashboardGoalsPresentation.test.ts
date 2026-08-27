import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { DashboardGoalSummary } from "@budget-app/shared";
import { dashboardGoalStatusDisplay } from "@budget-app/shared";
import {
  dashboardGoalAccessibilityLabel,
  dashboardGoalProgressSummary,
  dashboardGoalSummaryRecommendation,
} from "./dashboardGoalDisplay";

const goalsSectionSource = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "DashboardDetailsSections.tsx"),
  "utf8"
);
const goalCardSource = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "DashboardGoalCard.tsx"),
  "utf8"
);

function sampleGoal(overrides: Partial<DashboardGoalSummary> = {}): DashboardGoalSummary {
  return {
    id: 1,
    name: "Save for House Down Payment",
    goal_type: "house",
    current_amount: "2048.64",
    target_amount: "30000.00",
    remaining_amount: "27951.36",
    progress_percent: "6.8",
    projected_completion_date: null,
    on_track_status: "behind",
    recommended_monthly_contribution: "6987.84",
    priority: 1,
    status: "active",
    target_date: "2026-12-01",
    linked_account_name: "Main",
    is_debt_goal: false,
    pace_status: "behind",
    contribution_recommendation:
      "Need $6,987.84/month to reach your target date · $3,225.16/paycheck needed to reach target",
    monthly_required: "6987.84",
    ...overrides,
  };
}

describe("Dashboard goal card presentation", () => {
  it("uses DashboardGoalCard instead of inline dense card markup", () => {
    expect(goalsSectionSource).toMatch(/DashboardGoalCard/);
    expect(goalsSectionSource).not.toMatch(/dashboardGoalContributionLine/);
  });

  it("shows goal name, amounts, progress, target date, and monthly recommendation", () => {
    const goal = sampleGoal();
    expect(goalCardSource).toMatch(/goal\.name/);
    expect(dashboardGoalProgressSummary(goal)).toMatch(/\$2,048\.64 of \$30,000\.00 · 7%/);
    expect(dashboardGoalSummaryRecommendation(goal)).toBe("Need $6,987.84/month to reach target");
    expect(dashboardGoalAccessibilityLabel(goal)).toContain("Target Dec 2026");
  });

  it("does not render paycheck cadence on Dashboard", () => {
    const goal = sampleGoal();
    const recommendation = dashboardGoalSummaryRecommendation(goal);
    expect(recommendation).not.toMatch(/paycheck/i);
    expect(goalCardSource).not.toMatch(/paycheck/i);
    expect(goalCardSource).not.toMatch(/dashboardGoalContributionLine/);
  });

  it("uses friendly status labels on the card", () => {
    expect(goalCardSource).toMatch(/paceStatusLabel/);
    expect(goalCardSource).not.toMatch(/toUpperCase\(\)/);
  });

  it("includes a thin progress bar", () => {
    expect(goalCardSource).toMatch(/GoalProgressBar/);
    expect(goalCardSource).toMatch(/thin/);
  });

  it("truncates long goal titles to one line", () => {
    expect(goalCardSource).toMatch(/numberOfLines=\{1\}/);
    expect(goalCardSource).toMatch(/ellipsizeMode="tail"/);
  });

  it("opens specific goal details on card press", () => {
    expect(goalsSectionSource).toMatch(/goalDetailPath\(goal\.id\)/);
    expect(goalsSectionSource).toMatch(/goalsListPath\(\)/);
  });

  it("uses status-appropriate concise recommendation wording", () => {
    expect(dashboardGoalSummaryRecommendation(sampleGoal({ pace_status: "ahead", on_track_status: "ahead" }))).toBe(
      "Ahead of target pace"
    );
    expect(
      dashboardGoalSummaryRecommendation(
        sampleGoal({
          pace_status: "on_track",
          on_track_status: "on_track",
          contribution_recommendation: "Continue $500.00/month to stay on pace · $230.77/paycheck needed to reach target",
          monthly_required: "500.00",
        })
      )
    ).toBe("On pace for Dec 2026");
    expect(dashboardGoalSummaryRecommendation(sampleGoal({ pace_status: "completed", on_track_status: "ahead" }))).toBeNull();
  });
});

describe("Dashboard goal status (shared)", () => {
  it("shared dashboardGoalStatusDisplay still exposes uppercase labels for other consumers", () => {
    expect(
      dashboardGoalStatusDisplay({ pace_status: "behind", on_track_status: "behind" })?.label
    ).toBe("BEHIND");
  });
});
