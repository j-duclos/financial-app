import { describe, expect, it } from "vitest";
import type { DebtPayoffPlan } from "@budget-app/shared";
import {
  debtFreeSummary,
  interestCoverageGap,
  PLANNER_SUMMARY_METRICS,
} from "@budget-app/shared/paymentPlannerDisplay";
import {
  cardPayoffTagline,
  debtFreeHeadline,
  debtModeDescription,
  debtModeLabel,
  debtStrategyDescription,
  interestSavedLine,
  parseDebtModeParam,
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
      interest_this_month: "29.00",
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
    expect(debtFreeHeadline(basePlan())).toMatch(/Debt-free by Mar 2028/);
  });

  it("names the unpaid interest when payoff is not possible", () => {
    expect(
      debtFreeHeadline(
        basePlan({
          debt_free_possible: false,
          debt_free_date: null,
          cards: [
            {
              ...basePlan().cards[0]!,
              months_remaining: null,
              payoff_date: null,
              minimum_payment: "25.00",
              interest_this_month: "46.32",
            },
          ],
        })
      )
    ).toMatch(/interest unpaid/i);
    expect(
      debtFreeHeadline(basePlan({ debt_free_possible: false, debt_free_date: null }))
    ).not.toMatch(/increase payments to reach/i);
  });
});

describe("interestSavedLine", () => {
  it("formats savings vs minimums", () => {
    expect(interestSavedLine(basePlan())).toMatch(/1,280/);
  });

  it("returns null when no savings", () => {
    expect(interestSavedLine(basePlan({ interest_saved_vs_minimums: "0.00" }))).toBeNull();
  });

  it("returns null when baseline is not payoffable", () => {
    expect(
      interestSavedLine(
        basePlan({
          baseline_status: "baseline_not_payoffable",
          interest_saved_vs_minimums: null,
        })
      )
    ).toBeNull();
  });
});

describe("strategy and mode descriptions", () => {
  it("returns copy for selected strategy and mode", () => {
    expect(debtStrategyDescription("avalanche")).toMatch(/highest apr/i);
    expect(debtModeDescription("aggressive")).toMatch(/extra monthly/i);
    expect(debtModeLabel("survival")).toBe("Survival");
  });

  it("parses survival mode from the payment planner URL", () => {
    expect(parseDebtModeParam("survival")).toBe("survival");
    expect(parseDebtModeParam("aggressive")).toBe("aggressive");
    expect(parseDebtModeParam("nope")).toBeNull();
  });
});

describe("planner summary copy", () => {
  it("explains weighted APR and names interest this month", () => {
    expect(PLANNER_SUMMARY_METRICS.weightedApr.help).toMatch(/weighted by balance/i);
    expect(PLANNER_SUMMARY_METRICS.interestThisMonth.label).toBe("Interest this month");
  });

  it("never uses Needs higher pay on the debt-free tile", () => {
    const tile = debtFreeSummary(basePlan({ debt_free_date: null, debt_free_possible: false }));
    expect(tile.value).toBe("No date yet");
    expect(`${tile.value} ${tile.subtitle ?? ""}`).not.toMatch(/needs higher pay/i);
  });

  it("quantifies interest that minimums leave unpaid", () => {
    const unpaid = basePlan({
      debt_free_date: null,
      cards: [
        {
          ...basePlan().cards[0]!,
          minimum_payment: "25.00",
          interest_this_month: "46.32",
        },
        {
          ...basePlan().cards[0]!,
          account_id: 2,
          minimum_payment: "26.00",
          interest_this_month: "73.93",
        },
      ],
    });
    expect(interestCoverageGap(unpaid)).toBeCloseTo(69.25, 2);
  });
});

describe("cardPayoffTagline", () => {
  it("combines months and interest", () => {
    const line = cardPayoffTagline(basePlan().cards[0]!);
    expect(line).toContain("11 mo");
    expect(line).toContain("412");
  });
});
