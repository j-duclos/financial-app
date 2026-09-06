import { describe, expect, it } from "vitest";
import type { BillingStatus } from "./types";
import {
  OPERATIONAL_FORECAST_DAY_OPTIONS,
  FORECAST_WINDOW_LABELS,
  normalizeOperationalForecastDays,
} from "./forecastWindow";
import {
  FREE_PLAN_LIMITS,
  PREMIUM_PLAN_FORECAST_DAYS,
  atPlanLimit,
  canUsePlaidBankSync,
  clampForecastDaysForPlan,
  forecastOptionsForPlan,
  forecastPickerRows,
  isPremium,
  lockedForecastUpsellMessage,
  manualAccountLimitReachedMessage,
  manualAccountUsageLabel,
  maxOperationalForecastDays,
} from "./planLimits";

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
    limits: {
      linked_institutions: 0,
      manual_accounts: 3,
      recurring_rules: 10,
      operational_forecast_days: 90,
      goals: 2,
    },
    usage: {
      linked_institutions: 0,
      manual_accounts: 2,
      recurring_rules: 0,
      goals: 0,
    },
  },
};

const premiumStatus: BillingStatus = {
  ...freeStatus,
  plan: "PREMIUM",
  is_premium: true,
  status: "active",
  entitlements: {
    plan: "PREMIUM",
    is_premium: true,
    plaid_bank_sync: true,
    limits: {
      linked_institutions: null,
      manual_accounts: null,
      recurring_rules: null,
      operational_forecast_days: 365,
      goals: null,
    },
    usage: {
      linked_institutions: 1,
      manual_accounts: 5,
      recurring_rules: 12,
      goals: 4,
    },
  },
};

describe("operational forecast windows", () => {
  it("includes the Premium 365-day option", () => {
    expect(OPERATIONAL_FORECAST_DAY_OPTIONS).toEqual([30, 60, 90, 180, 365]);
    expect(FORECAST_WINDOW_LABELS[365]).toBe("1 year");
    expect(normalizeOperationalForecastDays(365)).toBe(365);
  });
});

describe("plan limits", () => {
  it("treats unknown billing as Free so 365 is not requestable", () => {
    expect(isPremium(undefined)).toBe(false);
    expect(maxOperationalForecastDays(undefined)).toBe(FREE_PLAN_LIMITS.operational_forecast_days);
    expect(forecastOptionsForPlan(undefined)).toEqual([30, 60, 90]);
    expect(clampForecastDaysForPlan(365, undefined)).toBe(90);
  });

  it("limits Free forecast options to 90 days and locks longer windows", () => {
    expect(forecastOptionsForPlan(freeStatus)).toEqual([30, 60, 90]);
    expect(forecastPickerRows(freeStatus).map((row) => [row.days, row.locked])).toEqual([
      [30, false],
      [60, false],
      [90, false],
      [180, true],
      [365, true],
    ]);
    expect(clampForecastDaysForPlan(365, freeStatus)).toBe(90);
    expect(lockedForecastUpsellMessage(365)).toBe("365-day forecasts are available with Premium.");
  });

  it("allows Premium to select through 365 days", () => {
    expect(isPremium(premiumStatus)).toBe(true);
    expect(canUsePlaidBankSync(premiumStatus)).toBe(true);
    expect(maxOperationalForecastDays(premiumStatus)).toBe(PREMIUM_PLAN_FORECAST_DAYS);
    expect(forecastOptionsForPlan(premiumStatus)).toEqual([30, 60, 90, 180, 365]);
    expect(forecastPickerRows(premiumStatus).every((row) => !row.locked)).toBe(true);
    expect(clampForecastDaysForPlan(365, premiumStatus)).toBe(365);
  });

  it("does not invent Plaid access for Free", () => {
    expect(canUsePlaidBankSync(freeStatus)).toBe(false);
    expect(canUsePlaidBankSync(undefined)).toBe(false);
  });

  it("reports Free manual-account usage and intercepts at the limit", () => {
    expect(manualAccountUsageLabel(freeStatus)).toBe("2 of 3 manual accounts");
    expect(atPlanLimit(freeStatus, "manual_accounts")).toBe(false);
    expect(manualAccountUsageLabel(premiumStatus)).toBeNull();
    expect(atPlanLimit(premiumStatus, "manual_accounts")).toBe(false);

    const atLimit: BillingStatus = {
      ...freeStatus,
      entitlements: {
        ...freeStatus.entitlements!,
        usage: { ...freeStatus.entitlements!.usage, manual_accounts: 3 },
      },
    };
    expect(atPlanLimit(atLimit, "manual_accounts")).toBe(true);
    expect(manualAccountLimitReachedMessage(atLimit)).toBe(
      "You've reached the Free plan limit of 3 manual accounts."
    );
  });
});
