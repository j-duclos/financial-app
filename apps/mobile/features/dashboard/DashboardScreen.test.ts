import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const dashboardSource = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "DashboardScreen.tsx"),
  "utf8"
);

describe("DashboardScreen request ordering", () => {
  it("starts fast, details, and extended risk concurrently when forecast is ready", () => {
    expect(dashboardSource).toMatch(/enabled: forecastReady/);
    expect(dashboardSource).toMatch(/\["dashboard-summary-fast", forecastDays\]/);
    expect(dashboardSource).toMatch(/\["dashboard-summary-details", forecastDays\]/);
    expect(dashboardSource).toMatch(/useExtendedCashRisk\(forecastReady\)/);
  });

  it("does not artificially delay the details request", () => {
    expect(dashboardSource).not.toMatch(/setTimeout/);
    expect(dashboardSource).not.toMatch(/350/);
    expect(dashboardSource).not.toMatch(/detailsEnabled/);
  });

  it("keeps progressive loading for fast vs details sections", () => {
    expect(dashboardSource).toMatch(/summaryFast && top/);
    expect(dashboardSource).toMatch(/detailsLoading && !details/);
  });
});
