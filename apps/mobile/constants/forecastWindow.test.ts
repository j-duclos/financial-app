import { describe, expect, it } from "vitest";
import {
  DEFAULT_OPERATIONAL_FORECAST_DAYS,
  normalizeOperationalForecastDays,
  forecastWindowLabel,
} from "@budget-app/shared";

describe("shared forecast window", () => {
  it("defaults invalid values to 30 days", () => {
    expect(normalizeOperationalForecastDays(undefined)).toBe(DEFAULT_OPERATIONAL_FORECAST_DAYS);
    expect(normalizeOperationalForecastDays(45)).toBe(30);
    expect(normalizeOperationalForecastDays(90)).toBe(90);
  });

  it("labels windows consistently with web", () => {
    expect(forecastWindowLabel(30)).toBe("30 days");
    expect(forecastWindowLabel(180)).toBe("6 months");
  });
});
