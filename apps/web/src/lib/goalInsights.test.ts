import { describe, expect, it } from "vitest";
import type { FinancialGoal } from "@budget-app/shared";
import {
  goalCardGapValue,
  goalCardMetrics,
  goalCurrentDepositValue,
  goalDetailForecastTable,
  goalDetailFunding,
  goalDetailProgressLine,
  goalForecastSummary,
  goalFundedProgressLine,
  goalFundingLine,
  goalPerPaycheckNeeded,
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

  it("combines funding account with progress on the card", () => {
    expect(
      goalFundedProgressLine(
        goal({
          funding_account_name: "Savings",
          current_amount: "1551.62",
          target_amount: "30000",
        })
      )
    ).toBe("Funded from Savings: $1,551.62 / $30,000.00");
  });

  it("uses configured paycheck deposit, not suggested biweekly", () => {
    expect(
      goalCurrentDepositValue(
        goal({
          automatic_transfer_label: "Paycheck funding: $183.55/week",
          suggested_biweekly: "3282.51",
        })
      )
    ).toBe("$183.55/week");
  });

  it("surfaces forecast figures on the main card", () => {
    const rows = goalCardMetrics(
      goal({
        target_date: "2026-12-01",
        projected_completion_date: "2029-08-17",
        automatic_transfer_label: "Paycheck funding: $183.55/week",
        monthly_required: "7112.10",
        current_contribution_rate: "795.39",
        suggested_biweekly: "3282.51",
        forecast_gap: "6316.71",
      })
    );
    const byLabel = Object.fromEntries(rows.map((row) => [row.label, row.value]));
    expect(byLabel["Target date"]).toBe("Dec 2026");
    expect(byLabel["Projected date"]).toBe("Aug 2029");
    expect(byLabel["Current monthly pace"]).toBe("$795.39/mo");
    expect(byLabel["Monthly needed"]).toBe("$7,112.10/mo");
    expect(byLabel["Current deposit per paycheck"]).toBeUndefined();
    expect(byLabel["Required per paycheck"]).toBeUndefined();
    expect(byLabel.Gap).toBeUndefined();
  });

  it("formats gap for the card footer row", () => {
    expect(goalCardGapValue(goal({ forecast_gap: "6316.71" }))).toBe("$6,316.71/mo");
  });

  it("builds a compact Goal Details forecast summary from backend fields", () => {
    const rows = goalDetailForecastTable(
      goal({
        target_date: "2026-12-01",
        projected_completion_date: "2029-08-17",
        monthly_required: "7112.10",
        current_contribution_rate: "795.39",
        forecast_gap: "6316.71",
        suggested_per_paycheck: "3282.51",
        suggested_biweekly: "9999.00",
      })
    );
    const byLabel = Object.fromEntries(rows.map((row) => [row.label, row.value]));
    expect(byLabel["Target date"]).toBe("Dec 2026");
    expect(byLabel["Projected completion"]).toBe("Aug 2029");
    expect(byLabel["Monthly needed"]).toBe("$7,112.10/mo");
    expect(byLabel["Current pace"]).toBe("$795.39/mo");
    expect(byLabel.Shortfall).toBe("$6,316.71/mo");
    expect(byLabel["Per paycheck needed"]).toBeUndefined();
    expect(byLabel.Surplus).toBeUndefined();
    expect(Object.keys(byLabel)).not.toContain("Completion");
  });

  it("shows surplus instead of a negative shortfall when ahead of pace", () => {
    const rows = goalForecastSummary(
      goal({
        monthly_required: "400.00",
        current_contribution_rate: "500.00",
        forecast_gap: "0.00",
        forecast_surplus: "100.00",
        pace_status: "ahead",
      })
    );
    const byLabel = Object.fromEntries(rows.map((row) => [row.label, row.value]));
    expect(byLabel.Surplus).toBe("$100.00/mo");
    expect(byLabel.Shortfall).toBeUndefined();
  });

  it("does not treat hardcoded biweekly as per-paycheck needed", () => {
    expect(
      goalPerPaycheckNeeded(
        goal({
          suggested_biweekly: "3282.51",
          suggested_per_paycheck: null,
        })
      )
    ).toBeNull();
  });

  it("formats Goal Details progress and funding copy", () => {
    expect(
      goalDetailProgressLine(
        goal({ current_amount: "1551.62", target_amount: "30000" })
      )
    ).toBe("$1,551.62 of $30,000.00");
    const funding = goalDetailFunding(
      goal({
        funding_account_name: "Savings",
        automatic_transfer_label: "Paycheck funding: $183.55/week",
        linked_rules: [
          {
            rule_id: 1,
            rule_name: "Paycheck",
            amount: "183.55",
            frequency: "WEEKLY",
            frequency_label: "week",
            label: "$183.55/week",
          },
        ],
      })
    );
    expect(funding.account).toBe("Savings");
    expect(funding.automatic).toBe("$183.55/week from paycheck");
  });
});
