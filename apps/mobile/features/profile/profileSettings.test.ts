import { describe, expect, it, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import {
  FORECAST_WINDOW_LABELS,
  OPERATIONAL_FORECAST_DAY_OPTIONS,
  type BillingStatus,
} from "@budget-app/shared";
import {
  developmentEnvironmentLabel,
  forecastWindowOptions,
  forecastWindowPickerOptions,
  FORECAST_PREFERENCE_QUERY_PREFIXES,
  hasConfiguredLegalLinks,
  invalidateAfterForecastWindowChange,
} from "./profileSettings";

describe("profileSettings helpers", () => {
  it("exposes only backend-supported forecast windows", () => {
    expect(forecastWindowOptions().map((o) => o.value)).toEqual([
      ...OPERATIONAL_FORECAST_DAY_OPTIONS,
    ]);
    expect(forecastWindowOptions().map((o) => o.label)).toEqual(
      OPERATIONAL_FORECAST_DAY_OPTIONS.map((d) => FORECAST_WINDOW_LABELS[d])
    );
  });

  it("locks 365 for Free profile picker and leaves it unlocked for Premium", () => {
    const free: BillingStatus = {
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
          manual_accounts: 0,
          recurring_rules: 0,
          goals: 0,
        },
      },
    };
    const premium: BillingStatus = {
      ...free,
      plan: "PREMIUM",
      is_premium: true,
      entitlements: {
        ...free.entitlements!,
        plan: "PREMIUM",
        is_premium: true,
        plaid_bank_sync: true,
        limits: { ...free.entitlements!.limits, operational_forecast_days: 365 },
      },
    };
    expect(forecastWindowPickerOptions(free).find((o) => o.value === 365)?.locked).toBe(true);
    expect(forecastWindowPickerOptions(free).filter((o) => !o.locked).map((o) => o.value)).toEqual([
      30, 60, 90,
    ]);
    expect(forecastWindowPickerOptions(premium).find((o) => o.value === 365)?.locked).toBe(false);
  });

  it("treats legal links as configured only when URLs/email exist", () => {
    expect(
      hasConfiguredLegalLinks({ privacyUrl: null, termsUrl: null, supportEmail: null })
    ).toBe(false);
    expect(
      hasConfiguredLegalLinks({
        privacyUrl: "https://example.com/privacy",
        termsUrl: null,
        supportEmail: null,
      })
    ).toBe(true);
  });

  it("formats development environment without EXPO_PUBLIC_ names", () => {
    const label = developmentEnvironmentLabel({
      appEnv: "development",
      apiTarget: "Local",
    });
    expect(label).toBe("Development · Local API");
    expect(label).not.toMatch(/EXPO_PUBLIC_/);
  });

  it("invalidates forecast-sensitive prefixes and skips monthly reports", () => {
    const queryClient = new QueryClient();
    const spy = vi.spyOn(queryClient, "invalidateQueries");
    invalidateAfterForecastWindowChange(queryClient);
    const keys = spy.mock.calls.map((c) => (c[0] as { queryKey: unknown[] }).queryKey);
    expect(keys).toEqual(
      expect.arrayContaining([
        ["profile"],
        ["dashboard-summary"],
        ["transactions"],
        ["timeline"],
        ["calendar-chunk"],
        ["accounts"],
        ["recommendations"],
      ])
    );
    expect(keys.some((k) => k[0] === "monthly-reports")).toBe(false);
    expect(keys.some((k) => k[0] === "goals-report")).toBe(false);
    expect(
      (FORECAST_PREFERENCE_QUERY_PREFIXES as readonly (readonly string[])[]).some(
        (p) => p[0] === "monthly-reports"
      )
    ).toBe(false);
    spy.mockRestore();
  });
});
