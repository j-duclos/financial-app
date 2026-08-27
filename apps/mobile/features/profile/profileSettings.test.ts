import { describe, expect, it, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import {
  FORECAST_WINDOW_LABELS,
  OPERATIONAL_FORECAST_DAY_OPTIONS,
} from "@budget-app/shared";
import {
  developmentEnvironmentLabel,
  forecastWindowOptions,
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
        ["timeline-calendar"],
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
