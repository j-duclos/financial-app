import { describe, expect, it } from "vitest";
import type { FinancialGoal } from "@budget-app/shared";
import {
  goalFundingLine,
  goalProjectionLine,
  goalSuggestionLine,
  paceStatusLabel,
} from "./goalInsights";

function goal(overrides: Partial<FinancialGoal> = {}): FinancialGoal {
  return {
    id: 1,
    household: 1,
    name: "House",
    goal_type: "house",
    target_amount: "30000",
    current_amount: "12000",
    target_date: "2026-12-01",
    linked_account: null,
    linked_credit_account: null,
    monthly_contribution: "0",
    priority: "high",
    status: "active",
    notes: "",
    created_at: "",
    updated_at: "",
    completed_at: null,
    remaining_amount: "18000",
    progress_percent: "40",
    projected_completion_date: null,
    on_track_status: "behind",
    recommended_monthly_contribution: "500",
    is_debt_goal: false,
    goal_health: "behind",
    monthly_required: "500",
    current_contribution_rate: null,
    forecast_gap: null,
    funding_account: null,
    milestones: [],
    ...overrides,
  };
}

describe("goalInsights", () => {
  it("shows stalled headline", () => {
    expect(
      goalProjectionLine(
        goal({ pace_status: "stalled", projection_headline: "No funding activity yet" })
      )
    ).toBe("No funding activity yet");
  });

  it("formats suggestion from monthly_required", () => {
    const line = goalSuggestionLine(goal({ monthly_required: "180" }));
    expect(line).toContain("180");
    expect(line).toMatch(/month/i);
  });

  it("shows funding from account name", () => {
    const { source } = goalFundingLine(
      goal({ funding_account_name: "Savings", has_automatic_funding: false })
    );
    expect(source).toBe("Funded from Savings");
  });

  it("labels pace status", () => {
    expect(paceStatusLabel("stalled")).toBe("Stalled");
    expect(paceStatusLabel("on_track")).toBe("On track");
  });
});
