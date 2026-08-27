import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const dashboardSource = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "DashboardScreen.tsx"),
  "utf8"
);

describe("DashboardScreen request ordering", () => {
  it("starts summary-fast immediately when forecast is ready", () => {
    expect(dashboardSource).toMatch(/enabled: forecastReady/);
    expect(dashboardSource).toMatch(/\["dashboard-summary-fast", forecastDays\]/);
  });

  it("waits for summary-fast success before details and extended risk", () => {
    expect(dashboardSource).toMatch(/dependentQueriesEnabled/);
    expect(dashboardSource).toMatch(/forecastReady && fastSuccess && !fastIsPlaceholderData/);
    expect(dashboardSource).toMatch(/enabled: dependentQueriesEnabled/);
    expect(dashboardSource).toMatch(/useExtendedCashRisk\(dependentQueriesEnabled\)/);
    expect(dashboardSource).not.toMatch(/useExtendedCashRisk\(forecastReady\)/);
  });

  it("does not gate details on summary-fast data presence alone", () => {
    expect(dashboardSource).not.toMatch(/enabled: forecastReady && !!summaryFast/);
    expect(dashboardSource).toMatch(/isSuccess: fastSuccess/);
  });

  it("does not artificially delay dependent requests", () => {
    expect(dashboardSource).not.toMatch(/setTimeout/);
    expect(dashboardSource).not.toMatch(/350/);
  });

  it("sequences pull-to-refresh: summary-fast before details and extended risk", () => {
    expect(dashboardSource).toMatch(/await refetchFast\(\)/);
    expect(dashboardSource).not.toMatch(
      /await Promise\.all\(\[\s*refetchFast\(\),\s*refetchDetails\(\)/
    );
  });

  it("keeps progressive loading for fast vs details sections", () => {
    expect(dashboardSource).toMatch(/FinancialHealthSection/);
    expect(dashboardSource).toMatch(/fastLoading && !summaryFast/);
    expect(dashboardSource).toMatch(/dashboardDetailsSectionState/);
  });

  it("does not launch dependent requests when summary-fast fails", () => {
    expect(dashboardSource).toMatch(/isSuccess: fastSuccess/);
    expect(dashboardSource).toMatch(/enabled: dependentQueriesEnabled/);
  });
});
