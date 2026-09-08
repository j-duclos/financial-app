import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { BillingStatus } from "@budget-app/shared";
import {
  FINANCIAL_HEALTH,
  clampForecastDaysForPlan,
  forecastPickerRows,
  isForecastDaysAllowed,
} from "@budget-app/shared";

const dir = dirname(fileURLToPath(import.meta.url));
const dashboardSource = readFileSync(join(dir, "DashboardScreen.tsx"), "utf8");
const healthSource = readFileSync(join(dir, "FinancialHealthSection.tsx"), "utf8");
const firstRunSource = readFileSync(join(dir, "DashboardFirstRun.tsx"), "utf8");
const forecastSelectSource = readFileSync(join(dir, "ForecastWindowSelect.tsx"), "utf8");
const detailsSource = readFileSync(join(dir, "DashboardDetailsSections.tsx"), "utf8");
const attentionCardSource = readFileSync(join(dir, "DashboardAttentionCard.tsx"), "utf8");

const freeBilling: BillingStatus = {
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

const premiumBilling: BillingStatus = {
  ...freeBilling,
  plan: "PREMIUM",
  is_premium: true,
  status: "active",
  entitlements: {
    plan: "PREMIUM",
    is_premium: true,
    plaid_bank_sync: true,
    payment_planner_full: true,
    reports_advanced: true,
    limits: {
      linked_institutions: null,
      manual_accounts: null,
      recurring_rules: null,
      operational_forecast_days: 365,
      goals: null,
    },
    usage: {
      linked_institutions: 1,
      manual_accounts: 4,
      recurring_rules: 11,
      goals: 3,
    },
  },
};

describe("mobile Home companion metrics", () => {
  it("renders only Lowest Forecast Balance, Available Cash, and Available Credit", () => {
    expect(healthSource).toMatch(/lowestForecastBalanceLabel/);
    expect(healthSource).toMatch(/FINANCIAL_HEALTH\.availableCash\.label/);
    expect(healthSource).toMatch(/FINANCIAL_HEALTH\.availableCredit\.label/);
    expect(FINANCIAL_HEALTH.availableCash.label).toBe("Available Cash");
    expect(FINANCIAL_HEALTH.availableCredit.label).toBe("Available Credit");
    expect(FINANCIAL_HEALTH.cashAfterDebt.label).toBe("Liquid Net Position");
  });

  it("does not render Liquid Net Position or Total Debt on Home", () => {
    expect(healthSource).not.toMatch(/FINANCIAL_HEALTH\.cashAfterDebt/);
    expect(healthSource).not.toMatch(/Liquid Net Position/);
    expect(healthSource).not.toMatch(/Total debt/);
    expect(healthSource).not.toMatch(/data\.debt/);
    expect(dashboardSource).not.toMatch(/Total debt/);
  });

  it("keeps Attention, Upcoming Money Flow, and Goals on Home", () => {
    expect(dashboardSource).toMatch(/AttentionRequiredSection/);
    expect(dashboardSource).toMatch(/DashboardUpcomingSection/);
    expect(dashboardSource).toMatch(/DashboardGoalsSection/);
    expect(detailsSource).toMatch(/DASHBOARD_SECTION\.upcoming/);
    expect(detailsSource).toMatch(/DASHBOARD_SECTION\.goals/);
    expect(detailsSource).toMatch(/All goals/);
    expect(attentionCardSource).toMatch(/chevron-right/);
    expect(attentionCardSource).not.toMatch(/ActionButton/);
  });

  it("places the Getting Started card below the Home header and above Financial Health", () => {
    expect(dashboardSource).toMatch(/GettingStartedCard/);
    const established = dashboardSource.slice(dashboardSource.lastIndexOf("ForecastWindowSelect"));
    expect(established.indexOf("{gettingStartedCard}")).toBeGreaterThan(-1);
    expect(established.indexOf("{gettingStartedCard}")).toBeLessThan(
      established.indexOf("<FinancialHealthSection")
    );
  });
});

describe("mobile Home onboarding status", () => {
  it("uses GET /api/onboarding/status rather than dashboard-value heuristics", () => {
    expect(dashboardSource).toMatch(/useOnboardingStatus/);
    expect(dashboardSource).toMatch(/isMissingAccounts/);
    expect(dashboardSource).toMatch(/enabled: loadDashboard/);
    expect(dashboardSource).not.toMatch(/isDashboardOnboarding/);
  });

  it("shows first-run empty state when the user has no accounts", () => {
    expect(dashboardSource).toMatch(/if \(firstRun\)/);
    expect(dashboardSource).toMatch(/DashboardFirstRun/);
    expect(firstRunSource).toMatch(/GETTING_STARTED_COPY\.welcomeTitle/);
    expect(firstRunSource).toMatch(/Add account manually/);
    expect(firstRunSource).toMatch(/Upgrade for automatic bank syncing/);
    expect(firstRunSource).toMatch(/Connect bank/);
  });

  it("mentions the FlowSight web app as a secondary first-run action", () => {
    expect(firstRunSource).toMatch(/APP_WEB_COMPANION_MESSAGE/);
    expect(firstRunSource).toMatch(/Open FlowSight on the web/);
    expect(firstRunSource).toMatch(/Linking\.openURL\(APP_WEB_URL\)/);
    expect(firstRunSource).toMatch(/variant="ghost"/);
    const addAccountIdx = firstRunSource.indexOf("Add account manually");
    const webLinkIdx = firstRunSource.indexOf("Open FlowSight on the web");
    expect(addAccountIdx).toBeGreaterThan(-1);
    expect(webLinkIdx).toBeGreaterThan(addAccountIdx);
  });

  it("does not show first-run for established users with accounts", () => {
    expect(dashboardSource).toMatch(/onboarding\?\.steps\.account === true/);
    expect(dashboardSource).toMatch(/const firstRun = missingAccounts/);
    expect(dashboardSource).toMatch(/FinancialHealthSection/);
    expect(dashboardSource).not.toMatch(/dismissMu/);
    expect(firstRunSource).not.toMatch(/dismiss/);
  });
});

describe("mobile forecast entitlements", () => {
  it("locks 365 for Free and does not submit a forbidden window", () => {
    const rows = forecastPickerRows(freeBilling);
    expect(rows.filter((row) => !row.locked).map((row) => row.days)).toEqual([30, 60, 90]);
    expect(rows.find((row) => row.days === 365)?.locked).toBe(true);
    expect(isForecastDaysAllowed(365, freeBilling)).toBe(false);
    expect(clampForecastDaysForPlan(365, freeBilling)).toBe(90);
    expect(forecastSelectSource).toMatch(/forecastPickerRows/);
    expect(forecastSelectSource).toMatch(/promptUpgrade/);
    expect(forecastSelectSource).toMatch(/lockedForecastUpsellMessage/);
    expect(forecastSelectSource).not.toMatch(/OPERATIONAL_FORECAST_DAY_OPTIONS\.map/);
  });

  it("allows Premium to select 365", () => {
    expect(forecastPickerRows(premiumBilling).find((row) => row.days === 365)?.locked).toBe(false);
    expect(isForecastDaysAllowed(365, premiumBilling)).toBe(true);
    expect(clampForecastDaysForPlan(365, premiumBilling)).toBe(365);
  });
});
