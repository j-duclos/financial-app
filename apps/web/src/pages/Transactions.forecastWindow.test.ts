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

  it("does not call payoff projection for known Free users and maps premium_required separately from auth", () => {
    expect(source).toMatch(/canUsePaymentPlannerFull\(billing\)/);
    expect(source).toMatch(/if \(!plannerFull\)/);
    expect(source).toMatch(/isPremiumRequiredError\(err\)/);
    expect(source).toMatch(/err\.status === 401/);
    expect(source).toMatch(/Payoff projections are available with Premium/);
  });

  it("keeps 30/60/90/6 months and does not offer a 12-month Forecast Window", () => {
    const forecastSelect = source.slice(
      source.indexOf(">Forecast Window<"),
      source.indexOf(">Account<")
    );
    expect(forecastSelect).toMatch(/forecastDayOptions/);
    expect(forecastSelect).toMatch(/FORECAST_WINDOW_LABELS/);
    expect(forecastSelect).not.toMatch(/12 months/);
  });
});
