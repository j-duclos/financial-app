import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const reportsSource = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "Reports.tsx"),
  "utf8"
);
const reportDisplay = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../lib/reportDisplay.ts"),
  "utf8"
);
const categoryBreakdown = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../lib/categoryBreakdownDisplay.ts"),
  "utf8"
);

describe("Reports information architecture", () => {
  it("exposes overview, cash flow, spending, goals, and debt sections", () => {
    expect(reportsSource).toMatch(/REPORT_TABS/);
    expect(reportsSource).toMatch(/tab === "overview"/);
    expect(reportsSource).toMatch(/tab === "cash-flow"/);
    expect(reportsSource).toMatch(/tab === "spending"/);
    expect(reportsSource).toMatch(/tab === "goals"/);
    expect(reportsSource).toMatch(/tab === "debt"/);
  });

  it("keeps a single monthly reports fetch and renders the selected tab", () => {
    expect(reportsSource).toMatch(/getMonthlyReports\(month/);
    expect(reportsSource).not.toMatch(/getMonthlySummary\(/);
    expect(reportsSource).not.toMatch(/getCategoryBreakdown\(/);
    expect(reportsSource).toMatch(/parseReportViewParam/);
  });

  it("does not stack cash-flow charts on overview", () => {
    const overviewIdx = reportsSource.indexOf("function OverviewSection");
    const cashIdx = reportsSource.indexOf("function CashFlowSection");
    expect(overviewIdx).toBeGreaterThan(-1);
    expect(cashIdx).toBeGreaterThan(overviewIdx);
    const overviewBody = reportsSource.slice(overviewIdx, cashIdx);
    expect(overviewBody).not.toMatch(/IncomeExpenseTrendChart/);
    expect(reportsSource.slice(cashIdx)).toMatch(/IncomeExpenseTrendChart/);
  });

  it("uses backend category share and show_comparison", () => {
    expect(reportsSource).toMatch(/expense_share_percent/);
    expect(reportsSource).toMatch(/show_comparison/);
    expect(reportsSource).toMatch(/formatExpenseSharePercent/);
    expect(reportsSource).not.toMatch(/shouldShowCategoryDelta/);
    expect(reportDisplay).not.toMatch(/shouldShowCategoryDelta/);
  });

  it("contains no client-side dollar/percentage materiality thresholds", () => {
    for (const src of [reportsSource, reportDisplay, categoryBreakdown]) {
      expect(src).not.toMatch(/shouldShowCategoryDelta/);
      expect(src).not.toMatch(/absDelta\s*<\s*0\.005/);
      expect(src).not.toMatch(/absDelta\s*<\s*25/);
      expect(src).not.toMatch(/categoryShare\s*<\s*0\.01/);
      expect(src).not.toMatch(/expenseSharePercent\s*\(/);
      expect(src).not.toMatch(/REPORT_CATEGORY_COMPARISON_MIN_/);
    }
  });

  it("uses overview totals for category table subtotals — not client partition math", () => {
    expect(reportsSource).toMatch(/incomeTotal=\{data\.overview\.total_income\}/);
    expect(reportsSource).toMatch(/expenseTotal=\{data\.overview\.total_expenses\}/);
    expect(reportsSource).toMatch(/netTotal=\{data\.overview\.net\}/);
    expect(categoryBreakdown).not.toMatch(/incomeSubtotal/);
    expect(categoryBreakdown).not.toMatch(/expenseSubtotal/);
  });

  it("preserves keepPreviousData and labels month switches as updating", () => {
    expect(reportsSource).toMatch(/keepPreviousData/);
    expect(reportsSource).toMatch(/dataMatchesMonth/);
    expect(reportsSource).toMatch(/Updating/);
  });

  it("distinguishes error from empty report data", () => {
    expect(reportsSource).toMatch(/isError && !data/);
    expect(reportsSource).toMatch(/Could not load reports/);
  });

  it("scopes monthly reports by household in the query key", () => {
    expect(reportsSource).toMatch(/\["monthly-reports", month, householdId/);
    expect(reportsSource).toMatch(/household_id: householdId/);
  });
});
