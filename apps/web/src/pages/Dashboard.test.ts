import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const dashboardSource = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "Dashboard.tsx"),
  "utf8"
);

const accountsSource = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "Accounts.tsx"),
  "utf8"
);

describe("Dashboard page structure", () => {
  it("includes command-center sections", () => {
    expect(dashboardSource).toMatch(/DashboardTopSummaryBar/);
    expect(dashboardSource).toMatch(/AttentionCardGrid/);
    expect(dashboardSource).toMatch(/RecommendationsPreviewSection/);
    expect(dashboardSource).toMatch(/UpcomingMoneyFlowPreviewSection/);
    expect(dashboardSource).toMatch(/GoalsProgressSection/);
    expect(dashboardSource).toMatch(/DashboardFinancialSnapshotLine/);
  });

  it("does not render large resource breakdown cards", () => {
    expect(dashboardSource).not.toMatch(/FinancialSnapshotCard/);
    expect(dashboardSource).not.toMatch(/resourceBreakdown/);
  });

  it("does not render page title or legacy health cards", () => {
    expect(dashboardSource).not.toMatch(/BillsChecklistInsight/);
    expect(dashboardSource).not.toMatch(/DashboardHealthCards/);
    expect(dashboardSource).not.toMatch(/InsightsSection/);
    expect(dashboardSource).not.toMatch(/Forecast-aware command center/);
    expect(dashboardSource).not.toMatch(/<h1[^>]*>Dashboard<\/h1>/);
  });

  it("places compact snapshot after goals", () => {
    const goalsIdx = dashboardSource.indexOf("<GoalsProgressSection");
    const snapshotIdx = dashboardSource.indexOf("<DashboardFinancialSnapshotLine");
    expect(goalsIdx).toBeGreaterThan(-1);
    expect(snapshotIdx).toBeGreaterThan(goalsIdx);
  });
});

describe("Accounts page structure", () => {
  it("includes compact portfolio summary above account groups", () => {
    expect(accountsSource).toMatch(/PortfolioSummaryBar/);
    expect(accountsSource).toMatch(/computePortfolioSummary/);
    const portfolioIdx = accountsSource.indexOf("<PortfolioSummaryBar");
    const groupsIdx = accountsSource.indexOf("<AccountGroupSection");
    expect(portfolioIdx).toBeGreaterThan(-1);
    expect(groupsIdx).toBeGreaterThan(portfolioIdx);
  });

  it("does not call dashboard summary from accounts", () => {
    expect(accountsSource).not.toMatch(/getDashboardSummary/);
    expect(accountsSource).not.toMatch(/getDashboardDetails/);
  });
});
