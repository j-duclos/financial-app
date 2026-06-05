import { describe, expect, it } from "vitest";
import type { Account, DebtPayoffCardSummary, PayoffProjection } from "@budget-app/shared";
import {
  defaultPaymentAmountForStrategy,
  drawerPaymentAmountDisplay,
  DRAWER_PAYOFF_STRATEGY_OPTIONS,
  normalizePaymentActionLabel,
  paymentToReachUtilization,
  PAYMENT_PLANNER_LABEL,
  payoffImpossibleWarning,
  payoffSummaryLine,
  strategyRequiresAmountInput,
  targetUtilizationPlanHint,
} from "./paymentPlannerDisplay";

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
    payoff_date: null,
    months_remaining: null,
    total_projected_interest: null,
    interest_this_month: "18.00",
    payoff_order: 1,
    promotional_apr: null,
    promotional_end_date: null,
    autopay_enabled: false,
    ...overrides,
  };
}

function mockAccount(overrides: Partial<Account> = {}): Account {
  return {
    id: 1,
    household: 1,
    account_type: "CREDIT",
    name: "Visa",
    institution: "",
    currency: "USD",
    is_active: true,
    created_at: "",
    updated_at: "",
    minimum_payment_amount: "25",
    statement_balance: "500",
    balance_owed: "1200",
    credit_limit: "5000",
    apr: "18",
    ...overrides,
  };
}

describe("paymentPlannerDisplay", () => {
  it("normalizePaymentActionLabel maps legacy copy", () => {
    expect(normalizePaymentActionLabel("Make payment")).toBe(PAYMENT_PLANNER_LABEL);
    expect(normalizePaymentActionLabel("Open payoff planner")).toBe(PAYMENT_PLANNER_LABEL);
    expect(normalizePaymentActionLabel("Pay credit card")).toBe(PAYMENT_PLANNER_LABEL);
  });

  it("paymentToReachUtilization matches target balance math", () => {
    const acc = mockAccount({
      balance_owed: "980",
      credit_limit: "1000",
      target_utilization_percent: "70",
      utilization_percent: "98",
    });
    expect(paymentToReachUtilization(acc, 70)).toBe(280);
    expect(targetUtilizationPlanHint(acc)).toContain("280");
    expect(targetUtilizationPlanHint(acc)).toContain("70%");
  });

  it("strategyRequiresAmountInput for custom and fixed", () => {
    expect(strategyRequiresAmountInput("custom_amount")).toBe(true);
    expect(strategyRequiresAmountInput("minimum_payment")).toBe(false);
  });

  it("defaultPaymentAmountForStrategy uses account fields", () => {
    const acc = mockAccount();
    expect(defaultPaymentAmountForStrategy(acc, "minimum_payment")).toBe("25");
    expect(defaultPaymentAmountForStrategy(acc, "statement_balance")).toBe("500");
    expect(defaultPaymentAmountForStrategy(acc, "current_balance")).toBe("1200");
  });

  it("statement balance falls back to balance owed when statement is zero", () => {
    const acc = mockAccount({ statement_balance: "0.00", balance_owed: "1274.58" });
    expect(defaultPaymentAmountForStrategy(acc, "statement_balance")).toBe("1274.58");
  });

  it("payoffSummaryLine for successful projection", () => {
    const proj: PayoffProjection = {
      payoff_possible: true,
      starting_balance: "1200",
      apr: "18",
      monthly_interest_rate: "1.5",
      payment_amount: "250",
      payoff_date: "2026-12-01",
      months_to_payoff: 7,
      total_interest: "120",
      total_paid: "1870",
      schedule: [],
    };
    expect(payoffSummaryLine(proj)).toContain("7 months");
    expect(payoffSummaryLine(proj)).toContain("250");
  });

  it("payoffImpossibleWarning renders message", () => {
    const proj: PayoffProjection = {
      payoff_possible: false,
      message: "Payment is too low to reduce balance.",
      starting_balance: "5000",
      apr: "24",
      monthly_interest_rate: "2",
      payment_amount: "10",
      payoff_date: null,
      months_to_payoff: 0,
      total_interest: "0",
      total_paid: "0",
      schedule: [],
    };
    expect(payoffImpossibleWarning(proj)).toBe("Payment is too low to reduce balance.");
  });

  it("drawerPaymentAmountDisplay falls back to plan minimum when account minimum is zero", () => {
    const acc = mockAccount({ minimum_payment_amount: "0.00" });
    const planCard = mockPlanCard({ minimum_payment: "25.00" });
    expect(
      drawerPaymentAmountDisplay(acc, planCard, "minimum_payment", "")
    ).toBe("25.00");
  });

  it("drawer payment scenarios omit statement balance", () => {
    expect(DRAWER_PAYOFF_STRATEGY_OPTIONS.map((o) => o.id)).toEqual([
      "minimum_payment",
      "custom_amount",
    ]);
  });
});
