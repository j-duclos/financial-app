import { describe, expect, it } from "vitest";
import type { DashboardRecommendation } from "./types";
import {
  recommendationIsCashForecastRisk,
  recommendationIsDebtPayoff,
  recommendationIsUtilizationHealth,
  recommendationLedgerFocus,
  recommendationPrimaryDestinationKind,
  recommendationWebPrimaryLabel,
  recommendationWebPrimaryTarget,
} from "./recommendationNavigation";

function utilizationRec(overrides: Partial<DashboardRecommendation> = {}): DashboardRecommendation {
  return {
    id: "utilization-5-10",
    severity: "critical",
    title: "Care Credit",
    why: "Utilization is 22%",
    recommended_action: "Pay $590.96 to reach your 10% target.",
    impact_label: null,
    impact_value: null,
    primary_action_label: "View account",
    primary_action_url: "/accounts?account=5",
    primary_action_type: "view_account",
    secondary_action_label: null,
    secondary_action_url: null,
    secondary_action_type: null,
    type: "reduce_utilization",
    account_id: 5,
    account_name: "Care Credit",
    impact_type: "credit_utilization",
    ...overrides,
  };
}

function debtPayoffRec(): DashboardRecommendation {
  return {
    ...utilizationRec(),
    id: "debt-payoff-5",
    type: "debt_payoff",
    primary_action_label: "Payment Planner",
    primary_action_url: "/credit-cards?account=5",
    primary_action_type: "navigate",
    impact_type: "debt_strategy",
  };
}

function cashRiskRec(): DashboardRecommendation {
  return {
    id: "attention-1",
    severity: "critical",
    title: "Main",
    why: "Projected negative Aug 27",
    recommended_action: "Add $1,406.40 before Aug 27.",
    impact_label: "Amount",
    impact_value: "1406.40",
    primary_action_label: "Open ledger",
    primary_action_url: "/transactions?account=1",
    primary_action_type: "open_ledger",
    secondary_action_label: null,
    secondary_action_url: null,
    secondary_action_type: null,
    type: "move_money",
    account_id: 1,
    account_name: "Main Checking",
    recommended_date: "2026-08-27",
    transaction_id: 99,
  };
}

describe("recommendationPrimaryDestinationKind", () => {
  it("routes reduce_utilization to view_account even with legacy /credit-cards URL", () => {
    const rec = utilizationRec({
      primary_action_url: "/credit-cards?account=5",
      primary_action_type: "navigate",
    });
    expect(recommendationIsUtilizationHealth(rec)).toBe(true);
    expect(recommendationPrimaryDestinationKind(rec)).toBe("view_account");
  });

  it("routes debt_payoff to payment_planner", () => {
    const rec = debtPayoffRec();
    expect(recommendationIsDebtPayoff(rec)).toBe(true);
    expect(recommendationPrimaryDestinationKind(rec)).toBe("payment_planner");
  });

  it("explicit primary_action_type beats legacy URL inference", () => {
    const rec = cashRiskRec({
      primary_action_url: "/accounts?account=1",
      primary_action_type: "open_ledger",
    });
    expect(recommendationPrimaryDestinationKind(rec)).toBe("open_ledger");
  });

  it("cash forecast risk opens ledger, not generic accounts", () => {
    const rec = cashRiskRec();
    expect(recommendationIsCashForecastRisk(rec)).toBe(true);
    expect(recommendationPrimaryDestinationKind(rec)).toBe("open_ledger");
  });
});

describe("recommendationWebPrimaryTarget", () => {
  it("reduce_utilization navigates to account detail on web", () => {
    expect(recommendationWebPrimaryTarget(utilizationRec())).toEqual({
      to: "/accounts?account=5",
    });
    expect(recommendationWebPrimaryLabel(utilizationRec())).toBe("View account");
  });

  it("debt_payoff navigates to payment planner", () => {
    expect(recommendationWebPrimaryTarget(debtPayoffRec())).toEqual({
      to: "/credit-cards?account=5",
    });
    expect(recommendationWebPrimaryLabel(debtPayoffRec())).toBe("Payment Planner");
  });

  it("cash risk preserves ledger focus context", () => {
    const target = recommendationWebPrimaryTarget(cashRiskRec());
    expect(target.to).toBe("/transactions");
    expect(target.state).toEqual({
      accountId: 1,
      prefillDate: "2026-08-27",
      focus: "ledger-event",
      focusTransactionId: 99,
    });
    expect(recommendationLedgerFocus(cashRiskRec())).toEqual({
      accountId: 1,
      focusDate: "2026-08-27",
      focusTransactionId: 99,
    });
  });
});
