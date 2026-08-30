import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const dir = dirname(fileURLToPath(import.meta.url));
const reportsData = readFileSync(join(dir, "useReportsData.ts"), "utf8");
const reportsScreen = readFileSync(join(dir, "ReportsScreen.tsx"), "utf8");
const reportDetail = readFileSync(join(dir, "ReportDetailScreen.tsx"), "utf8");

describe("Reports request orchestration", () => {
  it("does not fetch household list for default household discovery", () => {
    expect(reportsData).toMatch(/useDefaultHouseholdId/);
    expect(reportsData).not.toMatch(/listHouseholds/);
    expect(reportsData).not.toMatch(/householdsQuery/);
  });

  it("starts monthly report query when household id is available", () => {
    expect(reportsData).toMatch(/enabled: householdId != null/);
    expect(reportsData).toMatch(/getMonthlyReports/);
  });

  it("shares one monthly-reports query key across landing and detail", () => {
    expect(reportsData).toMatch(/reportsQueryKeys\.monthly/);
    expect(reportsData).toMatch(/keepPreviousData/);
    expect(reportsScreen).toMatch(/useReportsData/);
    expect(reportDetail).toMatch(/useReportsData/);
  });

  it("does not client-sum transactions for report totals", () => {
    expect(reportsData).not.toMatch(/listTransactions/);
    expect(reportsData).not.toMatch(/getTransactions/);
  });

  it("landing and detail reuse the same query helper — no duplicate monthly fetch path", () => {
    expect(reportsScreen).toMatch(/useReportsData\(activeFilters\)/);
    expect(reportDetail).toMatch(/useReportsData\(filters\)/);
    expect(reportsScreen).not.toMatch(/getMonthlyReports\(/);
    expect(reportDetail).not.toMatch(/getMonthlyReports\(/);
  });
});
