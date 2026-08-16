import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "Transactions.tsx"),
  "utf8"
);

describe("Transactions Forecast Window", () => {
  it("initializes from the saved profile default and does not persist page filters to Settings", () => {
    expect(source).toMatch(/usePageForecastWindow/);
    expect(source).toMatch(/daysToForecastRange/);
    expect(source).not.toMatch(/loadStoredTransactionsForecastRange/);
    expect(source).not.toMatch(/saveStoredTransactionsForecastRange/);
    expect(source).not.toMatch(/updateProfile/);
  });

  it("passes the selected window into timeline and account forecast queries", () => {
    expect(source).toMatch(/enabled: typeof accountId === "number" && forecastReady/);
    expect(source).toMatch(/forecast-summary", forecastDays/);
    expect(source).toMatch(/days: forecastDays/);
    expect(source).not.toMatch(/days: 90/);
  });

  it("keeps 30/60/90/6 months and does not offer a 12-month Forecast Window", () => {
    const forecastSelect = source.slice(
      source.indexOf(">Forecast Window<"),
      source.indexOf(">Account<")
    );
    expect(forecastSelect).toMatch(/30 days/);
    expect(forecastSelect).toMatch(/60 days/);
    expect(forecastSelect).toMatch(/90 days/);
    expect(forecastSelect).toMatch(/6 months/);
    expect(forecastSelect).not.toMatch(/12 months/);
  });
});
