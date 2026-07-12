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
  it("includes action-focused overview sections in priority order", () => {
    expect(dashboardSource).toMatch(/DashboardTopSummaryBar/);
    expect(dashboardSource).toMatch(/AttentionCardGrid/);
    expect(dashboardSource).toMatch(/UpcomingMoneyFlowPreviewSection/);
    expect(dashboardSource).toMatch(/GoalsPreviewSection/);

    const healthIdx = dashboardSource.indexOf("<DashboardTopSummaryBar");
    const attentionIdx = dashboardSource.indexOf("<AttentionCardGrid");
    const upcomingIdx = dashboardSource.indexOf("<UpcomingMoneyFlowPreviewSection");
    const goalsIdx = dashboardSource.indexOf("<GoalsPreviewSection");

    expect(healthIdx).toBeGreaterThan(-1);
    expect(attentionIdx).toBeGreaterThan(healthIdx);
    expect(upcomingIdx).toBeGreaterThan(attentionIdx);
    expect(goalsIdx).toBeGreaterThan(upcomingIdx);
  });

  it("uses a lightweight upcoming preview without the full calendar list", () => {
    const previewSource = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "../components/dashboard/UpcomingMoneyFlowPreview.tsx"),
      "utf8"
    );
    expect(previewSource).not.toMatch(/UpcomingList/);
    expect(previewSource).toMatch(/UPCOMING_PREVIEW_TRANSFER_FOOTER/);
    expect(previewSource).not.toMatch(/balance_after/);
    const calendarLinks = previewSource.match(/to=\{UPCOMING_CALENDAR_PATH\}/g) ?? [];
    expect(calendarLinks).toHaveLength(1);
  });

  it("does not render resource breakdown or legacy dashboard widgets", () => {
    expect(dashboardSource).not.toMatch(/FinancialSnapshotCard/);
    expect(dashboardSource).not.toMatch(/resourceBreakdown/);
    expect(dashboardSource).not.toMatch(/DashboardFinancialSnapshotLine/);
    expect(dashboardSource).not.toMatch(/GoalsProgressSection/);
    expect(dashboardSource).not.toMatch(/BillsChecklistInsight/);
    expect(dashboardSource).not.toMatch(/DashboardHealthCards/);
    expect(dashboardSource).not.toMatch(/InsightsSection/);
    expect(dashboardSource).not.toMatch(/Forecast-aware command center/);
    expect(dashboardSource).not.toMatch(/<h1[^>]*>Dashboard<\/h1>/);
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
