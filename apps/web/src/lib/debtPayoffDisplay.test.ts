import { describe, expect, it } from "vitest";
import type { DebtPayoffPlan } from "@budget-app/shared";
import {
  cardPayoffTagline,
  debtFreeHeadline,
  debtModeDescription,
  debtStrategyDescription,
  interestSavedLine,
} from "./debtPayoffDisplay";

const basePlan = (overrides: Partial<DebtPayoffPlan> = {}): DebtPayoffPlan => ({
  as_of: "2026-05-01",
  strategy: "avalanche",
  mode: "aggressive",
  extra_monthly: "150.00",
  monthly_payment_budget: "400.00",
  total_debt: "2500.00",
  weighted_apr: "22.50",
  monthly_interest_burn: "47.00",
  debt_free_date: "2028-03-01",
  months_to_debt_free: 22,
  debt_free_possible: true,
  total_interest: "820.00",
  total_paid: "3320.00",
  total_interest_minimums_only: "2100.00",
  interest_saved_vs_minimums: "1280.00",
  payoff_order: [1, 2],
  cards: [
    {
      account_id: 1,
      name: "Venture",
      balance: "1231.00",
      apr: "28.24",
      utilization_percent: "24.6",
      minimum_payment: "40.00",
      suggested_payment: "300.00",
      payoff_date: "2027-02-01",
      months_remaining: 11,
      total_projected_interest: "412.00",
      monthly_interest: "29.00",
      interest_saved_vs_minimums: "812.00",
    },
  ],
  timeline: [],
  milestones: [],
  recommendations: [],
  utilization_forecast: [],
  ...overrides,
});

describe("debtFreeHeadline", () => {
  it("celebrates zero debt", () => {
    expect(debtFreeHeadline(basePlan({ total_debt: "0.00" }))).toMatch(/debt free/i);
  });

  it("shows payoff date when possible", () => {
    expect(debtFreeHeadline(basePlan())).toBe("Debt-free by 03-01-28");
  });

  it("warns when payoff not possible", () => {
    expect(
      debtFreeHeadline(basePlan({ debt_free_possible: false, debt_free_date: null }))
    ).toMatch(/increase payments/i);
  });
});

describe("interestSavedLine", () => {
  it("formats savings vs minimums", () => {
    expect(interestSavedLine(basePlan())).toMatch(/1,280/);
  });

  it("returns null when no savings", () => {
    expect(interestSavedLine(basePlan({ interest_saved_vs_minimums: "0.00" }))).toBeNull();
  });
});

describe("strategy and mode descriptions", () => {
  it("returns copy for selected strategy and mode", () => {
    expect(debtStrategyDescription("avalanche")).toMatch(/highest apr/i);
    expect(debtModeDescription("aggressive")).toMatch(/extra monthly/i);
  });
});

describe("cardPayoffTagline", () => {
  it("combines months and interest", () => {
    const line = cardPayoffTagline(basePlan().cards[0]!);
    expect(line).toContain("11 mo");
    expect(line).toContain("412");
  });
});
