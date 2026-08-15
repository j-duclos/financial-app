import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const reportsSource = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "Reports.tsx"),
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
});
