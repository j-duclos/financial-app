import { describe, expect, it } from "vitest";
import type { DebtPayoffPlan } from "./types";
import {
  debtFreePlanMessage,
  debtFreeSummary,
  extraMonthlyApplies,
  interestCoverageGap,
  PLANNER_SUMMARY_METRICS,
  strategyNeedsExtraHint,
  survivalIgnoresExtraHint,
} from "./paymentPlannerDisplay";

function plan(overrides: Partial<DebtPayoffPlan> = {}): DebtPayoffPlan {
  return {
    as_of: "2026-09-04",
    strategy: "avalanche",
    mode: "aggressive",
    extra_monthly: "0.00",
    monthly_payment_budget: "104.00",
    total_debt: "6180.69",
    weighted_apr: "29.06",
    monthly_interest_burn: "149.69",
    debt_free_date: null,
    months_to_debt_free: null,
    debt_free_possible: false,
    total_interest: "0.00",
    interest_saved_vs_minimums: null,
    payoff_order: [1, 2, 3],
    cards: [
      {
        account_id: 1,
        name: "Care Credit",
        balance: "1070.96",
        apr: "32.99",
        credit_limit: "4800.00",
        utilization_percent: "22.31",
        minimum_payment: "53.00",
        suggested_payment: "53.00",
        payoff_date: "2028-09-01",
        months_remaining: 24,
        total_projected_interest: "352.37",
        interest_this_month: "20.44",
        payoff_order: 1,
        promotional_apr: null,
        promotional_end_date: null,
        autopay_enabled: false,
      },
      {
        account_id: 2,
        name: "Savor",
        balance: "1968.31",
        apr: "28.24",
        credit_limit: "2000.00",
        utilization_percent: "98.42",
        minimum_payment: "25.00",
        suggested_payment: "25.00",
        payoff_date: null,
        months_remaining: null,
        total_projected_interest: null,
        interest_this_month: "46.32",
        payoff_order: 2,
        promotional_apr: null,
        promotional_end_date: null,
        autopay_enabled: false,
      },
      {
        account_id: 3,
        name: "Venture",
        balance: "3141.42",
        apr: "28.24",
        credit_limit: "3000.00",
        utilization_percent: "104.71",
        minimum_payment: "26.00",
        suggested_payment: "26.00",
        payoff_date: null,
        months_remaining: null,
        total_projected_interest: null,
        interest_this_month: "73.93",
        payoff_order: 3,
        promotional_apr: null,
        promotional_end_date: null,
        autopay_enabled: false,
      },
    ],
    timeline: [],
    milestones: [],
    recommendations: [],
    utilization_forecast: [],
    ...overrides,
  };
}

describe("planner summary metrics", () => {
  it("explains weighted APR in plain language", () => {
    expect(PLANNER_SUMMARY_METRICS.weightedApr.label).toBe("Weighted APR");
    expect(PLANNER_SUMMARY_METRICS.weightedApr.help).toMatch(/weighted by balance/i);
    expect(PLANNER_SUMMARY_METRICS.interestThisMonth.label).toBe("Interest this month");
    expect(PLANNER_SUMMARY_METRICS.interestThisMonth.help).toMatch(/this month/i);
  });
});

describe("interestCoverageGap", () => {
  it("sums interest that minimums do not cover", () => {
    // Savor 46.32-25 + Venture 73.93-26; Care Credit min covers interest
    expect(interestCoverageGap(plan())).toBeCloseTo(69.25, 2);
  });

  it("is zero when every minimum covers interest", () => {
    expect(
      interestCoverageGap(
        plan({
          cards: plan().cards.map((c) => ({
            ...c,
            minimum_payment: "200.00",
            interest_this_month: "10.00",
          })),
        })
      )
    ).toBe(0);
  });
});

describe("debtFreeSummary", () => {
  it("never uses Needs higher pay", () => {
    const tile = debtFreeSummary(plan());
    expect(tile.value).toBe("No date yet");
    expect(tile.subtitle).toMatch(/cover interest/i);
    expect(`${tile.value} ${tile.subtitle}`).not.toMatch(/needs higher pay/i);
  });

  it("shows month-year and remaining months when payoff is modeled", () => {
    const tile = debtFreeSummary(
      plan({
        debt_free_date: "2028-03-01",
        months_to_debt_free: 18,
        debt_free_possible: true,
      })
    );
    expect(tile.value).toMatch(/Mar.*2028/);
    expect(tile.subtitle).toMatch(/18 months/);
  });

  it("celebrates zero debt", () => {
    expect(debtFreeSummary(plan({ total_debt: "0.00" })).value).toBe("Paid off");
  });
});

describe("debtFreePlanMessage", () => {
  it("names the unpaid interest instead of scolding", () => {
    expect(debtFreePlanMessage(plan())).toMatch(/\$69\.25\/mo of interest unpaid/);
    expect(debtFreePlanMessage(plan())).not.toMatch(/increase payments to reach/i);
  });
});

describe("strategy and survival hints", () => {
  it("explains why strategies look identical at $0 extra", () => {
    expect(strategyNeedsExtraHint("0")).toMatch(/\$0 extra/i);
    expect(strategyNeedsExtraHint("500")).toBeNull();
  });

  it("flags extra that survival mode will ignore", () => {
    expect(extraMonthlyApplies("survival")).toBe(false);
    expect(extraMonthlyApplies("aggressive")).toBe(true);
    expect(survivalIgnoresExtraHint("survival", "500")).toBe(true);
    expect(survivalIgnoresExtraHint("aggressive", "500")).toBe(false);
  });
});
