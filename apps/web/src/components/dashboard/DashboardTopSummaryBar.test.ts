import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { DEPRECATED_DASHBOARD_LABELS, FINANCIAL_HEALTH } from "../../lib/dashboardTerminology";

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

  it("renders Lowest Projected Cash and avoids deprecated accounting terms", () => {
    const source = readFileSync(join(dir, "DashboardTopSummaryBar.tsx"), "utf8");
    expect(source).toContain("FINANCIAL_HEALTH.lowestProjectedCash.label");
    expect(source).toContain("lowest_projected_cash");
    expect(source).toContain("lowestProjectedCashDisplayValue");
    expect(source).not.toContain("safe_to_spend");
    expect(source).not.toContain("Spending Cushion");
    expect(source).not.toContain("You are short by");
    expect(source).not.toContain("after bills, buffers, and reserved savings");
    expect(source).not.toContain("safeToSpendDisplayValue");
    expect(FINANCIAL_HEALTH.lowestProjectedCash.label).toBe("Lowest Projected Cash");
    for (const deprecated of DEPRECATED_DASHBOARD_LABELS) {
      expect(source).not.toContain(`"${deprecated}"`);
    }
  });
});

describe("Dashboard page top bar wiring", () => {
  it("does not use safe_to_spend for the first Financial Health card", () => {
    expect(dashboardPage).toContain("lowest_projected_cash");
    expect(dashboardPage).not.toMatch(/summaryFast\.safe_to_spend/);
  });
});
