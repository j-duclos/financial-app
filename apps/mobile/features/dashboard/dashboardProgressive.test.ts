import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { attentionViewAllPath } from "./navigation";
import { ATTENTION_VIEW_ALL_PATH } from "@budget-app/shared";

const dashboardSource = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "DashboardScreen.tsx"),
  "utf8"
);
const financialHealthSource = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "FinancialHealthSection.tsx"),
  "utf8"
);
const detailsSource = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "DashboardDetailsSections.tsx"),
  "utf8"
);

describe("Dashboard progressive loading architecture", () => {
  it("renders home shell without waiting on financial queries", () => {
    expect(dashboardSource).toMatch(/Home/);
    expect(dashboardSource).toMatch(/ForecastWindowSelect/);
    expect(dashboardSource).not.toMatch(/if \(.*isLoading.*\) return null/);
    expect(dashboardSource).not.toMatch(/await Promise\.all\(\[\s*getDashboardSummaryFast/);
  });

  it("uses independent TanStack queries with keepPreviousData for forecast changes", () => {
    expect(dashboardSource).toMatch(/keepPreviousData/);
    expect(dashboardSource).toMatch(/\["dashboard-summary-fast", forecastDays\]/);
    expect(dashboardSource).toMatch(/\["dashboard-summary-details", forecastDays\]/);
    expect(dashboardSource).toMatch(/placeholderData: keepPreviousData/);
  });

  it("does not block upcoming or goals UI on summary-fast completion", () => {
    expect(dashboardSource).toMatch(/details\?\.upcoming_groups/);
    expect(dashboardSource).toMatch(/details\?\.goals/);
    expect(dashboardSource).not.toMatch(/summaryFast &&.*DashboardUpcomingSection/);
    expect(dashboardSource).not.toMatch(/summaryFast &&.*DashboardGoalsSection/);
  });

  it("sequences details request after summary-fast success", () => {
    expect(dashboardSource).toMatch(/dependentQueriesEnabled/);
    expect(dashboardSource).toMatch(/enabled: dependentQueriesEnabled/);
    expect(dashboardSource).toMatch(/isSuccess: fastSuccess/);
  });

  it("does not block financial health on dashboard details", () => {
    expect(dashboardSource).toMatch(/topSummaryFromDashboard\(summaryFast\)/);
    expect(dashboardSource).not.toMatch(/details\?\.snapshot/);
  });

  it("uses section-level loading flags with cached data preserved", () => {
    expect(dashboardSource).toMatch(/fastLoading && !summaryFast/);
    expect(dashboardSource).toMatch(/dashboardDetailsSectionState/);
    expect(detailsSource).toMatch(/sectionState === "loading"/);
  });

  it("isolates query failures to their sections", () => {
    expect(financialHealthSource).toMatch(/error && !data/);
    expect(detailsSource).toMatch(/sectionState === "error"/);
    expect(dashboardSource).not.toMatch(/fastError \? \(\s*<ErrorState/);
  });

  it("passes first cash shortfall independently to upcoming preview", () => {
    expect(dashboardSource).toMatch(/firstCashShortfall=\{summaryFast\?\.first_cash_shortfall\}/);
    expect(dashboardSource).toMatch(/buildUpcomingDashboardPreview\(upcomingGroups/);
    expect(dashboardSource).toMatch(/preview=\{upcomingPreview\}/);
    expect(detailsSource).not.toMatch(/buildUpcomingDashboardPreview/);
  });

  it("shows recalculating state when forecast window changes with prior data", () => {
    expect(dashboardSource).toMatch(/recalculating/);
    expect(dashboardSource).toMatch(/fastIsPlaceholderData/);
    expect(dashboardSource).toMatch(/Updating…/);
  });

  it("does not use setTimeout to orchestrate dashboard requests", () => {
    expect(dashboardSource).not.toMatch(/setTimeout/);
  });

  it("uses shaped financial health skeleton instead of one generic card", () => {
    expect(financialHealthSource).toMatch(/FinancialHealthSkeleton/);
    expect(dashboardSource).not.toMatch(/SkeletonBlock lines=\{5\}/);
  });

  it("tracks development-only first-content timing marks", () => {
    expect(dashboardSource).toMatch(/markDashboardTiming/);
    expect(dashboardSource).toMatch(/summary-fast-request-start/);
    expect(dashboardSource).toMatch(/summary-fast-response/);
    expect(dashboardSource).toMatch(/details-request-start/);
    expect(dashboardSource).toMatch(/details-response/);
    expect(dashboardSource).toMatch(/financial-health-rendered/);
    expect(dashboardSource).toMatch(/upcoming-rendered/);
    expect(dashboardSource).toMatch(/home-fully-useful/);
    expect(dashboardSource).toMatch(/extended-risk-enabled/);
  });

  it("keeps cached dashboard visible during background refresh via Updating… not RefreshControl", () => {
    expect(dashboardSource).toMatch(/pullRefreshing/);
    expect(dashboardSource).toMatch(/refreshing=\{pullRefreshing\}/);
    expect(dashboardSource).toMatch(/Updating…/);
    expect(dashboardSource).not.toMatch(/refreshing=\{\s*pullRefreshing\s*\|\|/);
  });
});

describe("Dashboard navigation fixes", () => {
  it("routes view-all attention to Action Center", () => {
    expect(attentionViewAllPath()).toBe("/action-center");
    expect(ATTENTION_VIEW_ALL_PATH).toBe("/action-center");
  });
});
