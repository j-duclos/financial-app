import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { DEPRECATED_DASHBOARD_LABELS, lowestForecastBalanceLabel } from "../../lib/dashboardTerminology";

const dir = dirname(fileURLToPath(import.meta.url));
const dashboardPage = readFileSync(
  join(dir, "../../pages/Dashboard.tsx"),
  "utf8"
);

describe("DashboardTopSummaryBar", () => {
  it("exports summary bar component", async () => {
    const mod = await import("./DashboardTopSummaryBar");
    expect(typeof mod.default).toBe("function");
  });

  it("renders Lowest Forecast Balance and avoids deprecated accounting terms", () => {
    const source = readFileSync(join(dir, "DashboardTopSummaryBar.tsx"), "utf8");
    expect(source).toContain("lowestForecastBalanceLabel");
    expect(source).toContain("lowest_projected_cash");
    expect(source).toContain("lowestProjectedCashDisplayValue");
    expect(source).not.toContain("safe_to_spend");
    expect(source).not.toContain("Spending Cushion");
    expect(source).not.toContain("You are short by");
    expect(source).not.toContain("after bills, buffers, and reserved savings");
    expect(source).not.toContain("safeToSpendDisplayValue");
    expect(lowestForecastBalanceLabel(30)).toBe("Lowest Forecast Balance (30 Days)");
    for (const deprecated of DEPRECATED_DASHBOARD_LABELS) {
      expect(source).not.toContain(`"${deprecated}"`);
    }
  });
});

describe("Dashboard page top bar wiring", () => {
  it("does not use safe_to_spend for the first Financial Health card", () => {
    expect(dashboardPage).toContain("first_cash_shortfall");
    expect(dashboardPage).not.toMatch(/summaryFast\.safe_to_spend/);
  });
});
