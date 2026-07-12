import { describe, expect, it } from "vitest";
import type { Account, DashboardRecommendation } from "@budget-app/shared";
import {
  accountShowsResolveRisk,
  recommendationShowsResolveRisk,
  simulationPreviewLines,
} from "./resolveRiskDisplay";

function cashAccount(overrides: Partial<Account> = {}): Account {
  return {
    id: 1,
    account_type: "CHECKING",
    health_status: null,
    risk_status: null,
    lowest_projected_balance_30_days: null,
    ...overrides,
  } as Account;
}

describe("accountShowsResolveRisk", () => {
  it("returns false for credit cards", () => {
    expect(accountShowsResolveRisk(cashAccount({ account_type: "CREDIT", risk_status: "critical" }))).toBe(
      false
    );
  });

  it("returns true for critical or risk status", () => {
    expect(accountShowsResolveRisk(cashAccount({ risk_status: "critical" }))).toBe(true);
    expect(accountShowsResolveRisk(cashAccount({ risk_status: "risk" }))).toBe(true);
  });

  it("returns true when lowest projected balance is negative", () => {
    expect(
      accountShowsResolveRisk(cashAccount({ lowest_projected_balance_30_days: "-12.50" }))
    ).toBe(true);
  });
});

describe("recommendationShowsResolveRisk", () => {
  it("requires account_id and critical or at_risk severity", () => {
    expect(
      recommendationShowsResolveRisk({
        account_id: null,
        severity: "critical",
      } as DashboardRecommendation)
    ).toBe(false);
    expect(
      recommendationShowsResolveRisk({
        account_id: 2,
        severity: "at_risk",
      } as DashboardRecommendation)
    ).toBe(true);
    expect(
      recommendationShowsResolveRisk({
        account_id: 2,
        severity: "healthy",
      } as DashboardRecommendation)
    ).toBe(false);
  });

  it("excludes credit utilization and payment planner recommendations", () => {
    expect(
      recommendationShowsResolveRisk({
        account_id: 5,
        severity: "at_risk",
        type: "reduce_utilization",
        id: "utilization-5-70",
        why: "Venture utilization is 122%.",
        primary_action_url: "/credit-cards?account=5",
      } as DashboardRecommendation)
    ).toBe(false);
    expect(
      recommendationShowsResolveRisk({
        account_id: 1,
        severity: "critical",
        type: "move_money",
        why: "Checking projected negative.",
        primary_action_url: "/transactions?transfer=1",
      } as DashboardRecommendation)
    ).toBe(true);
  });
});

describe("simulationPreviewLines", () => {
  it("formats lowest and improvement", () => {
    const lines = simulationPreviewLines({
      simulated_lowest_projected_balance: "38.00",
      base_lowest_projected_balance: "-562.00",
      improvement_amount: "600.00",
      risk_resolved: true,
      result_status: "resolved",
    });
    expect(lines.lowestLine).toContain("38");
    expect(lines.improvementLine).toContain("600");
    expect(lines.statusLabel).toBeTruthy();
  });
});
