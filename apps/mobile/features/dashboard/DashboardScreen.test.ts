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

  it("starts details after summary-fast success; defers extended risk until details settle", () => {
    expect(dashboardSource).toMatch(/dependentQueriesEnabled/);
    expect(dashboardSource).toMatch(/forecastReady && fastSuccess && !fastIsPlaceholderData/);
    expect(dashboardSource).toMatch(/enabled: dependentQueriesEnabled/);
    expect(dashboardSource).toMatch(/useExtendedCashRisk\(extendedRiskEnabled\)/);
    expect(dashboardSource).not.toMatch(/useExtendedCashRisk\(dependentQueriesEnabled\)/);
    expect(dashboardSource).not.toMatch(/useExtendedCashRisk\(forecastReady\)/);
    expect(dashboardSource).toMatch(/detailsSettled/);
    expect(dashboardSource).toMatch(/InteractionManager\.runAfterInteractions/);
    expect(dashboardSource).toMatch(/EXTENDED_CASH_RISK_QUERY_KEY/);
  });

  it("does not gate details on summary-fast data presence alone", () => {
    expect(dashboardSource).not.toMatch(/enabled: forecastReady && !!summaryFast/);
    expect(dashboardSource).toMatch(/isSuccess: fastSuccess/);
  });

  it("does not artificially delay details with a fixed timeout", () => {
    expect(dashboardSource).not.toMatch(/setTimeout/);
    expect(dashboardSource).not.toMatch(/350/);
  });

  it("sequences pull-to-refresh: summary-fast before details and extended risk", () => {
    expect(dashboardSource).toMatch(/await refetchFast\(\)/);
    expect(dashboardSource).not.toMatch(
      /await Promise\.all\(\[\s*refetchFast\(\),\s*refetchDetails\(\)/
    );
    expect(dashboardSource).toMatch(/invalidateQueries\(\{ queryKey: \["extended-cash-risk"\] \}\)/);
  });

  it("keeps RefreshControl tied to explicit pull lifecycle only", () => {
    expect(dashboardSource).toMatch(/refreshing=\{pullRefreshing\}/);
    expect(dashboardSource).not.toMatch(/extendedFetching/);
    expect(dashboardSource).not.toMatch(
      /refreshing=\{\s*pullRefreshing\s*\|\|/
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

  it("uses a prefetch signature lock instead of a boolean once-flag", () => {
    expect(dashboardSource).toMatch(/homeTransactionsPrefetchSignature/);
    expect(dashboardSource).toMatch(/transactionsPrefetchSignatureRef/);
    expect(dashboardSource).not.toMatch(/transactionsPrefetchedRef/);
  });
});
