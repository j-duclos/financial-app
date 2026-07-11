import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { DEPRECATED_DASHBOARD_LABELS, FINANCIAL_HEALTH } from "../../lib/dashboardTerminology";

const dir = dirname(fileURLToPath(import.meta.url));

describe("DashboardTopSummaryBar", () => {
  it("exports summary bar component", async () => {
    const mod = await import("./DashboardTopSummaryBar");
    expect(typeof mod.default).toBe("function");
  });

  it("renders Lowest Projected Cash and avoids deprecated accounting terms", () => {
    const source = readFileSync(join(dir, "DashboardTopSummaryBar.tsx"), "utf8");
    expect(source).toContain("FINANCIAL_HEALTH.cashAfterDebt.label");
    expect(source).toContain("FINANCIAL_HEALTH.availableCash.label");
    expect(source).toContain("FINANCIAL_HEALTH.lowestProjectedCash.help");
    expect(source).toContain("lowestProjectedCashDisplayValue");
    expect(source).toContain("lowest_projected_cash");
    expect(source).not.toContain("Spending Cushion");
    expect(source).not.toContain("safeToSpendDisplayValue");
    expect(source).toMatch(/hero/);
    expect(source).toContain("Forecast window");
    expect(source).toContain("forecast-window-select");
    expect(source).toContain("METRIC_TILE_GRID_5");
    expect(source).toContain("DebtPayoffInsight");
    for (const deprecated of DEPRECATED_DASHBOARD_LABELS) {
      expect(source).not.toContain(`"${deprecated}"`);
    }
  });
});
