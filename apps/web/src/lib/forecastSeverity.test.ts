import { describe, expect, it } from "vitest";
import {
  determineForecastSeverity,
  forecastSeverityCellClass,
  forecastSeverityIcon,
  forecastSeverityLabel,
} from "./forecastSeverity";

describe("forecastSeverity", () => {
  it("maps API heat levels to severity", () => {
    expect(determineForecastSeverity({ heat_level: "dangerous" })).toBe("dangerous");
    expect(determineForecastSeverity({ heat_level: "tight" })).toBe("tight");
    expect(determineForecastSeverity({ risk_level: "critical" })).toBe("dangerous");
  });

  it("exposes labels and icons", () => {
    expect(forecastSeverityLabel("tight")).toBe("At Risk");
    expect(forecastSeverityLabel("dangerous")).toBe("Critical");
    expect(forecastSeverityIcon("dangerous")).toBe("🔴");
  });

  it("fades quiet neutral days", () => {
    expect(forecastSeverityCellClass("neutral", false)).toContain("bg-white");
    expect(forecastSeverityCellClass("dangerous", true)).toContain("border-red");
  });
});
