import { describe, expect, it, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import {
  FORECAST_WINDOW_LABELS,
  OPERATIONAL_FORECAST_DAY_OPTIONS,
  type BillingStatus,
} from "@budget-app/shared";
import {
  developmentEnvironmentLabel,
  emailSettingsRow,
  forecastWindowOptions,
  forecastWindowPickerOptions,
  FORECAST_PREFERENCE_QUERY_PREFIXES,
  hasConfiguredLegalLinks,
  invalidateAfterForecastWindowChange,
  clientDeleteAccountError,
  clientPasswordErrors,
  DELETE_CONFIRMATION,
  profileEmailDisplay,
  profileExportFallbackName,
  shouldShowResendVerification,
  transactionsCsvFallbackName,
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
    const premium: BillingStatus = {
      ...free,
      plan: "PREMIUM",
      is_premium: true,
      entitlements: {
        ...free.entitlements!,
        plan: "PREMIUM",
        is_premium: true,
        plaid_bank_sync: true,
        payment_planner_full: true,
        reports_advanced: true,
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

  it("shows email, verification state, and Add email when blank", () => {
    expect(profileEmailDisplay("joe@example.com")).toBe("joe@example.com");
    expect(profileEmailDisplay("")).toBe("No email address");
    expect(emailSettingsRow({ email: "joe@example.com", verified: true })).toEqual({
      title: "Email",
      value: "Verified",
      subtitle: "joe@example.com",
    });
    expect(emailSettingsRow({ email: "joe@example.com", verified: false })).toEqual({
      title: "Email",
      value: "Not verified",
      subtitle: "joe@example.com",
    });
    expect(emailSettingsRow({ email: "", verified: false })).toEqual({
      title: "Email",
      value: "Add email",
    });
    expect(shouldShowResendVerification({ email: "joe@example.com", verified: false })).toBe(true);
    expect(shouldShowResendVerification({ email: "joe@example.com", verified: true })).toBe(false);
    expect(shouldShowResendVerification({ email: "", verified: false })).toBe(false);
  });

  it("blocks password mismatch and missing current password", () => {
    expect(
      clientPasswordErrors({
        currentPassword: "",
        newPassword: "abcdefgh",
        confirmPassword: "abcdefgh",
      })?.current
    ).toMatch(/current password/i);
    expect(
      clientPasswordErrors({
        currentPassword: "oldpass1",
        newPassword: "newpass12",
        confirmPassword: "newpass13",
      })?.confirm
    ).toMatch(/do not match/i);
    expect(
      clientPasswordErrors({
        currentPassword: "oldpass1",
        newPassword: "newpass12",
        confirmPassword: "newpass12",
      })
    ).toBeNull();
  });

  it("requires DELETE plus current password before account deletion", () => {
    expect(DELETE_CONFIRMATION).toBe("DELETE");
    expect(clientDeleteAccountError({ currentPassword: "", confirmation: "DELETE" })).toMatch(
      /current password/i
    );
    expect(clientDeleteAccountError({ currentPassword: "secret", confirmation: "delete" })).toMatch(
      /DELETE/
    );
    expect(clientDeleteAccountError({ currentPassword: "secret", confirmation: "DELETE" })).toBeNull();
  });

  it("uses dated export filenames without client-side CSV math", () => {
    expect(profileExportFallbackName("2026-09-06")).toBe("financial-app-data-2026-09-06.json");
    expect(transactionsCsvFallbackName("2026-09-06")).toBe(
      "financial-app-transactions-2026-09-06.csv"
    );
  });
});
