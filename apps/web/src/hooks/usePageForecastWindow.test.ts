import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "usePageForecastWindow.ts"),
  "utf8"
);

describe("usePageForecastWindow", () => {
  it("reads the saved default from the shared profile query", () => {
    expect(source).toMatch(/useProfileQuery/);
    expect(source).toMatch(/default_forecast_days/);
    expect(source).toMatch(/normalizeOperationalForecastDays/);
  });

  it("keeps page selection local and never PATCHes the profile", () => {
    expect(source).toMatch(/setOverride/);
    expect(source).not.toMatch(/updateProfile/);
    expect(source).not.toMatch(/method: "PATCH"/);
  });

  it("waits for profile fetch before treating the default as ready", () => {
    expect(source).toMatch(/isFetched \|\| isError/);
    expect(source).toMatch(/ready/);
  });

  it("clamps a saved Forecast Window that exceeds the current plan", () => {
    expect(source).toMatch(/forecastOptionsForPlan/);
    expect(source).toMatch(/allowed\.includes\(savedDefault\)/);
    expect(source).toMatch(/allowed\.includes\(requested\)/);
  });
});
