import { describe, expect, it } from "vitest";
import {
  DEFAULT_OPERATIONAL_FORECAST_DAYS,
  FORECAST_WINDOW_LABELS,
  OPERATIONAL_FORECAST_DAY_OPTIONS,
  forecastWindowLabel,
  normalizeOperationalForecastDays,
} from "./forecastWindow";

describe("operational Forecast Window", () => {
  it("defaults to 30 days", () => {
    expect(DEFAULT_OPERATIONAL_FORECAST_DAYS).toBe(30);
    expect(normalizeOperationalForecastDays(undefined)).toBe(30);
    expect(normalizeOperationalForecastDays(null)).toBe(30);
    expect(normalizeOperationalForecastDays(45)).toBe(30);
    expect(normalizeOperationalForecastDays(1)).toBe(30);
    expect(normalizeOperationalForecastDays(9999)).toBe(30);
  });

  it("accepts the constrained operational set", () => {
    expect(OPERATIONAL_FORECAST_DAY_OPTIONS).toEqual([30, 60, 90, 180]);
    expect(normalizeOperationalForecastDays(60)).toBe(60);
    expect(normalizeOperationalForecastDays(90)).toBe(90);
    expect(normalizeOperationalForecastDays(180)).toBe(180);
  });

  it("uses human-friendly labels and never exposes 180 to users", () => {
    expect(FORECAST_WINDOW_LABELS[180]).toBe("6 months");
    expect(forecastWindowLabel(180)).toBe("6 months");
    expect(forecastWindowLabel(30)).toBe("30 days");
    expect(Object.values(FORECAST_WINDOW_LABELS).join(" ")).not.toMatch(/\b180\b/);
  });
});
