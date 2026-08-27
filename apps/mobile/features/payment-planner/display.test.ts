import { describe, expect, it } from "vitest";
import type { Account, DebtPayoffCardSummary, DebtPayoffPlan } from "@budget-app/shared";
import {
  baselineNotPayoffableLine,
  debtCardOutcomeLines,
  debtFreeHeadline,
  debtRowMetaLine,
  formatDebtFreeMonth,
  formatMoneyOrDash,
  interestSavedLine,
  paymentToReachUtilization,
  planIsRecalculating,
  priorityReasonLabel,
  targetUtilizationPercent,
  WHAT_IF_NUMERIC_DEBOUNCE_MS,
} from "@/features/payment-planner/display";
import { paymentPlannerQueryKeys } from "@/features/payment-planner/queryKeys";

function mockPlanCard(overrides: Partial<DebtPayoffCardSummary> = {}): DebtPayoffCardSummary {
  return {
    account_id: 1,
    name: "Visa",
    balance: "1200.00",
    apr: "18.00",
    credit_limit: "5000.00",
    utilization_percent: "24.00",
    minimum_payment: "25.00",
    suggested_payment: "150.00",
    payoff_date: "2027-06-01",
    months_remaining: 12,
    total_projected_interest: "180.00",
    interest_this_month: "18.00",
    payoff_order: 1,
    payoff_status: "projected",
    priority_reason: {
      code: "highest_apr",
      label: "Highest APR (18.00%) — avalanche strategy pays this first",
    },
    promotional_apr: null,
    promotional_end_date: null,
    autopay_enabled: false,
    ...overrides,
  };
}

function mockPlan(overrides: Partial<DebtPayoffPlan> = {}): DebtPayoffPlan {
  return {
    as_of: "2026-08-26",
    strategy: "avalanche",
    mode: "aggressive",
    extra_monthly: "150.00",
    monthly_payment_budget: "400.00",
    total_debt: "2500.00",
    weighted_apr: "20.00",
    monthly_interest_burn: "42.00",
    debt_free_date: "2028-01-01",
    months_to_debt_free: 18,
    debt_free_possible: true,
    total_interest: "500.00",
    interest_saved_vs_minimums: "200.00",
    baseline_status: "payoffable",
    payoff_order: [1],
    cards: [mockPlanCard()],
    timeline: [],
    milestones: [],
    recommendations: [{ id: "focus", priority: "high", message: "Pay Visa first" }],
    utilization_forecast: [],
    ...overrides,
  };
}

function mockAccount(overrides: Partial<Account> = {}): Account {
  return {
    id: 1,
    household: { id: 1, name: "Home" } as Account["household"],
    account_type: "CREDIT",
    role: "none",
    name: "Visa",
    institution: "",
    currency: "USD",
    is_active: true,
    created_at: "",
    updated_at: "",
    credit_limit: "1000",
    balance_owed: "980",
    target_utilization_percent: "10",
    ...overrides,
  } as Account;
}

describe("payment planner display", () => {
  it("renders debt-free headline from canonical plan data", () => {
    const headline = debtFreeHeadline(mockPlan());
    expect(headline).toContain("Debt-free by");
    expect(headline).toContain("(projected)");
  });

  it("shows interest saved from backend field", () => {
    expect(interestSavedLine(mockPlan())).toContain("200");
    expect(interestSavedLine(mockPlan())).toMatch(/Projected interest savings/);
  });

  it("hides savings when baseline cannot amortize", () => {
    const plan = mockPlan({
      baseline_status: "baseline_not_payoffable",
      interest_saved_vs_minimums: null,
    });
    expect(interestSavedLine(plan)).toBeNull();
    expect(baselineNotPayoffableLine(plan)).toMatch(/would not pay off/);
  });

  it("never formats NaN for invalid money", () => {
    expect(formatMoneyOrDash("not-a-number")).toBe("—");
    expect(formatMoneyOrDash(Number.NaN)).toBe("—");
    expect(formatMoneyOrDash("5877.34")).not.toContain("NaN");
  });

  it("formats compact debt-free month", () => {
    expect(formatDebtFreeMonth(mockPlan({ debt_free_date: "2029-04-15" }))).toMatch(/Apr.*2029|2029/);
    expect(
      formatDebtFreeMonth(
        mockPlan({ debt_free_date: null, debt_free_possible: false, simulation_status: "non_amortizing" })
      )
    ).toBe("—");
  });

  it("uses compact debt card outcome lines", () => {
    const lines = debtCardOutcomeLines(mockPlanCard({ months_remaining: 1 }));
    expect(lines.headline).toBe("Payoff next payment");
    expect(debtCardOutcomeLines(mockPlanCard({ payoff_status: "non_amortizing" })).headline).toMatch(
      /too low/i
    );
    expect(debtRowMetaLine(mockPlanCard())).toMatch(/18\.00% APR/);
  });

  it("uses backend priority reason label", () => {
    expect(priorityReasonLabel(mockPlanCard())).toContain("Highest APR");
  });

  it("uses user-configured utilization target, not hard-coded thresholds", () => {
    const acc = mockAccount({ target_utilization_percent: "10" });
    expect(targetUtilizationPercent(acc)).toBe(10);
    expect(paymentToReachUtilization(acc)).toBe(880);

    const at30 = mockAccount({ target_utilization_percent: "30" });
    expect(paymentToReachUtilization(at30)).toBe(680);
  });

  it("detects pending recalculation while debouncing", () => {
    expect(
      planIsRecalculating(
        { extraMonthly: "1500", lumpSum: "" },
        { extraMonthly: "150", lumpSum: "" },
        true
      )
    ).toBe(true);
    expect(
      planIsRecalculating(
        { extraMonthly: "150", lumpSum: "" },
        { extraMonthly: "150", lumpSum: "" },
        true
      )
    ).toBe(false);
  });
});

describe("payment planner query keys", () => {
  it("reuses cache for identical scenario inputs", () => {
    const inputs = {
      strategy: "avalanche" as const,
      mode: "aggressive" as const,
      extraMonthly: "150",
      lumpSum: "",
      lumpSumAccountId: null,
    };
    expect(paymentPlannerQueryKeys.plan(inputs)).toEqual(paymentPlannerQueryKeys.plan({ ...inputs }));
    expect(paymentPlannerQueryKeys.plan(inputs)).not.toEqual(
      paymentPlannerQueryKeys.plan({ ...inputs, extraMonthly: "200" })
    );
  });

  it("exports debounce constant for scenario inputs", () => {
    expect(WHAT_IF_NUMERIC_DEBOUNCE_MS).toBeGreaterThanOrEqual(350);
  });
});
