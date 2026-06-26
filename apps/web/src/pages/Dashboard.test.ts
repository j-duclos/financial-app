import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DASHBOARD_SECTION } from "../lib/dashboardTerminology";

const dashboardSource = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "Dashboard.tsx"),
  "utf8"
);

describe("Dashboard page structure", () => {
  it("includes command-center sections", () => {
    expect(dashboardSource).toMatch(/DashboardTopSummaryBar/);
    expect(dashboardSource).toMatch(/AttentionCardGrid/);
    expect(dashboardSource).toMatch(/RecommendationsPreviewSection/);
    expect(dashboardSource).toMatch(/UpcomingMoneyFlowPreviewSection/);
    expect(dashboardSource).toMatch(/GoalsProgressSection/);
    expect(dashboardSource).toMatch(/FinancialSnapshotCard/);
  });

  it("does not render page title or legacy health cards", () => {
    expect(dashboardSource).not.toMatch(/BillsChecklistInsight/);
    expect(dashboardSource).not.toMatch(/DashboardHealthCards/);
    expect(dashboardSource).not.toMatch(/InsightsSection/);
    expect(dashboardSource).not.toMatch(/Forecast-aware command center/);
    expect(dashboardSource).not.toMatch(/<h1[^>]*>Dashboard<\/h1>/);
  });

  it("renders recommendations preview section", () => {
    expect(dashboardSource).toMatch(/RecommendationsPreviewSection/);
  });

  it("orders operational sections before resource breakdown", () => {
    const healthIdx = dashboardSource.indexOf("DashboardTopSummaryBar");
    const attentionIdx = dashboardSource.indexOf("Attention Required");
    const recommendationsIdx = dashboardSource.indexOf("RecommendationsPreviewSection");
    const upcomingIdx = dashboardSource.indexOf("UpcomingMoneyFlowPreviewSection");
    const resourceIdx = dashboardSource.indexOf("<FinancialSnapshotCard");
    const goalsIdx = dashboardSource.indexOf("Goals &amp; Progress");
    expect(healthIdx).toBeGreaterThan(-1);
    expect(resourceIdx).toBeGreaterThan(upcomingIdx);
    expect(resourceIdx).toBeLessThan(goalsIdx);
    expect(attentionIdx).toBeLessThan(resourceIdx);
    expect(recommendationsIdx).toBeLessThan(resourceIdx);
    expect(dashboardSource).toContain("DASHBOARD_SECTION.resourceBreakdown");
  });

  it("does not use deprecated financial snapshot section title", () => {
    expect(dashboardSource).not.toContain("Financial Snapshot");
  });
});
