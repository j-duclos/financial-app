import { describe, expect, it } from "vitest";
import type { BillingStatus } from "@budget-app/shared";
import { canUsePlaidBankSync, canUsePaymentPlannerFull, canUseReportsAdvanced, forecastOptionsForPlan, isPremium } from "./entitlements";
import { PLAID_PREMIUM_MESSAGE, PREMIUM_BENEFITS } from "./billing";

const freeStatus: BillingStatus = {
  plan: "FREE",
  is_premium: false,
  status: "inactive",
  cancel_at_period_end: false,
  current_period_end: null,
  has_stripe_customer: false,
  entitlements: {
    plan: "FREE",
    is_premium: false,
    plaid_bank_sync: false,
    payment_planner_full: false,
    reports_advanced: false,
    limits: {
      linked_institutions: 0,
      manual_accounts: 3,
      recurring_rules: 10,
      operational_forecast_days: 90,
      goals: 2,
    },
    usage: {
      linked_institutions: 0,
      manual_accounts: 0,
      recurring_rules: 0,
      goals: 0,
    },
  },
};

describe("launch entitlements", () => {
  it("does not grant Plaid to Free users", () => {
    expect(canUsePlaidBankSync(freeStatus)).toBe(false);
    expect(isPremium(freeStatus)).toBe(false);
  });

  it("does not grant Payment Planner full simulation to Free users", () => {
    expect(canUsePaymentPlannerFull(freeStatus)).toBe(false);
    expect(canUsePaymentPlannerFull(undefined)).toBe(false);
  });

  it("does not grant Advanced Reports to Free users", () => {
    expect(canUseReportsAdvanced(freeStatus)).toBe(false);
    expect(canUseReportsAdvanced(undefined)).toBe(false);
  });

  it("limits Free forecast options to 90 days", () => {
    expect(forecastOptionsForPlan(freeStatus)).toEqual([30, 60, 90]);
    expect(forecastOptionsForPlan(freeStatus)).not.toContain(180);
    expect(forecastOptionsForPlan(freeStatus)).not.toContain(365);
  });

  it("markets automatic bank syncing without promising unlimited institutions", () => {
    expect(PLAID_PREMIUM_MESSAGE).toBe("Automatic bank syncing is available with Premium.");
    expect(PREMIUM_BENEFITS.join(" ")).toMatch(/Automatic bank syncing/i);
    expect(PREMIUM_BENEFITS.join(" ")).not.toMatch(/unlimited bank/i);
  });
});
