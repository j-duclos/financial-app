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
  it("initializes Forecast Window from the saved profile default and keys queries by days", () => {
    expect(dashboardSource).toMatch(/usePageForecastWindow/);
    expect(dashboardSource).toMatch(/enabled: forecastReady/);
    expect(dashboardSource).toMatch(/\["dashboard-summary-fast", forecastDays\]/);
    expect(dashboardSource).toMatch(/\["dashboard-summary-details", forecastDays\]/);
    expect(dashboardSource).toMatch(/EXTENDED_CASH_RISK_QUERY_KEY|extended-cash-risk/);
    expect(dashboardSource).not.toMatch(/\["extended-cash-risk", forecastDays\]/);
    expect(dashboardSource).toMatch(/getDashboardSummaryFast\(\{ forecast_days: forecastDays \}\)/);
    expect(dashboardSource).not.toMatch(/updateProfile/);
  });

  it("includes action-focused overview sections in priority order", () => {
    expect(dashboardSource).toMatch(/DashboardTopSummaryBar/);
    expect(dashboardSource).toMatch(/LookingAheadBanner/);
    expect(dashboardSource).toMatch(/isLookingAheadVisible/);
    expect(dashboardSource).toMatch(/AttentionCardGrid/);
    expect(dashboardSource).toMatch(/first_cash_shortfall/);
    expect(dashboardSource).toMatch(/GoalsPreviewSection/);

    const healthIdx = dashboardSource.indexOf("<DashboardTopSummaryBar");
    const lookingAheadIdx = dashboardSource.indexOf("<LookingAheadBanner");
    const attentionIdx = dashboardSource.indexOf("<AttentionCardGrid");
    const upcomingIdx = dashboardSource.indexOf("<UpcomingMoneyFlowPreviewSection");
    const goalsIdx = dashboardSource.indexOf("<GoalsPreviewSection");

    expect(healthIdx).toBeGreaterThan(-1);
    expect(lookingAheadIdx).toBeGreaterThan(healthIdx);
    expect(attentionIdx).toBeGreaterThan(lookingAheadIdx);
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
    expect(previewSource).toMatch(/balance_after/);
    expect(previewSource).toMatch(/upcomingFullTimelineLinkLabel/);
    expect(previewSource).toMatch(/truncatedMessage/);
    expect(previewSource).not.toMatch(/Projected end-of-day balance/);
    expect(previewSource).not.toMatch(/PreviewDaySummary/);
    expect(previewSource).not.toMatch(
      /truncatedMessage[\s\S]{0,80}border-amber-200/
    );
    const calendarLinks = previewSource.match(/to=\{UPCOMING_CALENDAR_PATH\}/g) ?? [];
    expect(calendarLinks).toHaveLength(1);
    expect(previewSource).not.toMatch(/upcomingTimelineLinkLabel/);
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

  it("enables details immediately after summary-fast success without a fixed delay", () => {
    expect(dashboardSource).toMatch(/detailsEnabled = forecastReady && fastSuccess/);
    expect(dashboardSource).not.toMatch(/setTimeout\(\(\) => setDetailsEnabled\(true\), 350\)/);
    expect(dashboardSource).not.toMatch(/window\.setTimeout\(\(\) => setDetailsEnabled/);
  });

  it("does not fall back to listAllBuckets when details goals are empty", () => {
    expect(dashboardSource).not.toMatch(/listAllBuckets/);
    expect(dashboardSource).not.toMatch(/\["buckets", "all"\]/);
    expect(dashboardSource).toMatch(/details\?\.goals \?\? \[\]/);
  });

  it("defers extended cash risk until after details settle", () => {
    expect(dashboardSource).toMatch(/requestIdleCallback|runWhenIdle/);
    expect(dashboardSource).toMatch(/extendedRiskEnabled/);
    expect(dashboardSource).not.toMatch(/useExtendedCashRisk\(forecastReady && !!summaryFast\)/);
  });

  it("uses shared isDashboardOnboarding for empty-state detection", () => {
    expect(dashboardSource).toMatch(/isDashboardOnboarding/);
    expect(dashboardSource).not.toMatch(
      /summaryFast\.recommendations\?\.length \?\? summaryFast\.insights\.length/
    );
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
