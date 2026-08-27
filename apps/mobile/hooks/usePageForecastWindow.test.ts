import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "usePageForecastWindow.ts"),
  "utf8"
);

describe("usePageForecastWindow", () => {
  it("reads the saved default from the shared profile hook", () => {
    expect(source).toMatch(/useProfile/);
    expect(source).toMatch(/default_forecast_days/);
    expect(source).toMatch(/normalizeOperationalForecastDays/);
    expect(source).not.toMatch(/queryFn:\s*\(\)\s*=>\s*getProfile\(\)/);
  });

  it("keeps page selection local and never PATCHes the profile", () => {
    expect(source).toMatch(/setOverride/);
    expect(source).not.toMatch(/updateProfile/);
    expect(source).not.toMatch(/method: "PATCH"/);
  });

  it("allows dashboard requests before profile arrives using the canonical default", () => {
    expect(source).toMatch(/DEFAULT_OPERATIONAL_FORECAST_DAYS/);
    expect(source).toMatch(/ready = auth\.isAuthenticated/);
  });
});
