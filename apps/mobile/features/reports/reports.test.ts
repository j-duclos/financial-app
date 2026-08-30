import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { partitionCategoryBreakdown, topExpenseCategories } from "./categoryBreakdownDisplay";
import {
  categoryDetailPath,
  parseReportRouteParams,
  reportAccountDetailPath,
  reportDetailPath,
  reportGoalDetailPath,
  transactionsForReportCategory,
} from "./navigation";
import { reportsQueryKeys } from "./queryKeys";
import {
  comparisonTone,
  comparisonToneForContext,
  formatDeltaVsPrevious,
  formatExpenseSharePercent,
  formatSignedAmount,
  parseOptionalAmount,
  parseReportTypeParam,
} from "./reportDisplay";
import type { CategoryBreakdownItem } from "@budget-app/shared";

const dir = dirname(fileURLToPath(import.meta.url));
const reportSections = readFileSync(join(dir, "components/ReportSections.tsx"), "utf8");
const reportsScreen = readFileSync(join(dir, "ReportsScreen.tsx"), "utf8");
const reportDetail = readFileSync(join(dir, "ReportDetailScreen.tsx"), "utf8");
const reportDisplaySrc = readFileSync(join(dir, "reportDisplay.ts"), "utf8");
const categoryRow = readFileSync(join(dir, "components/CategoryBreakdownRow.tsx"), "utf8");
const moreScreen = readFileSync(join(dir, "../more/MoreScreen.tsx"), "utf8");

function mockCategory(overrides: Partial<CategoryBreakdownItem> = {}): CategoryBreakdownItem {
  return {
    category_id: 1,
    category_name: "Groceries",
    total: "-120.00",
    previous_total: "-100.00",
    delta: "-20.00",
    expense_share_percent: "50.0",
    show_comparison: true,
    percent_change: "20.0",
    ...overrides,
  };
}

describe("reportDisplay", () => {
  it("formats signed amounts with an explicit plus or minus", () => {
    expect(formatSignedAmount("17164")).toMatch(/^\+/);
    expect(formatSignedAmount("-812")).toMatch(/^-/);
    expect(formatSignedAmount("0")).not.toMatch(/^[+-]/);
  });

  it("describes month-over-month deltas", () => {
    expect(formatDeltaVsPrevious("1220", "2026-07")).toContain("vs Jul");
    expect(formatDeltaVsPrevious("0", "2026-07")).toContain("No change");
  });

  it("does not contain production dollar/percentage significance thresholds", () => {
    expect(reportDisplaySrc).not.toMatch(/absDelta < 0\.005/);
    expect(reportDisplaySrc).not.toMatch(/< 0\.01/);
    expect(reportDisplaySrc).not.toMatch(/absDelta < 25/);
    expect(reportDisplaySrc).not.toMatch(/shouldShowCategoryDelta/);
    expect(reportDisplaySrc).not.toMatch(/expenseSharePercent\(/);
  });

  it("formats backend expense share without recomputing from amounts", () => {
    expect(formatExpenseSharePercent("50.0")).toBe("50%");
    expect(formatExpenseSharePercent("0.4")).toBe("0%");
    expect(formatExpenseSharePercent(null)).toBeNull();
    expect(formatExpenseSharePercent("NaN")).toBeNull();
  });

  it("does not silently treat malformed amounts as zero", () => {
    expect(parseOptionalAmount("NaN")).toBeNull();
    expect(parseOptionalAmount("Infinity")).toBeNull();
    expect(parseOptionalAmount(undefined)).toBeNull();
    expect(parseOptionalAmount("12.5")).toBe(12.5);
    expect(formatSignedAmount("not-a-number")).toBe("—");
  });

  it("parses report type route params", () => {
    expect(parseReportTypeParam("spending")).toBe("spending");
    expect(parseReportTypeParam("cash-flow")).toBe("cash-flow");
    expect(parseReportTypeParam("cash_flow")).toBe("cash-flow");
    expect(parseReportTypeParam("unknown")).toBeNull();
    expect(parseReportTypeParam("budget")).toBeNull();
  });

  it("uses neutral MoM tone for expense context", () => {
    expect(comparisonTone("50")).toBe("positive");
    expect(comparisonTone("-50")).toBe("negative");
    expect(comparisonToneForContext("-50", "expense")).toBe("neutral");
    expect(comparisonToneForContext("50", "expense")).toBe("neutral");
    expect(comparisonToneForContext("50", "income")).toBe("positive");
  });
});

describe("categoryBreakdownDisplay", () => {
  it("partitions income and expenses without financial subtotals", () => {
    const result = partitionCategoryBreakdown([
      mockCategory({ category_name: "Salary", total: "3000", category_id: 2 }),
      mockCategory(),
      mockCategory({ category_name: "Transfer", total: "-500", category_id: 3 }),
      mockCategory({ category_name: "Bank Transfer", total: "-100", category_id: 4 }),
      mockCategory({ category_name: "Uncategorized", total: "-40", category_id: null }),
    ]);

    expect(result.income).toHaveLength(1);
    expect(result.expenses).toHaveLength(2);
    expect(result).not.toHaveProperty("incomeSubtotal");
    expect(result).not.toHaveProperty("expenseSubtotal");
    expect(result).not.toHaveProperty("net");
  });

  it("sorts expenses by amount ascending (most negative first)", () => {
    const result = partitionCategoryBreakdown([
      mockCategory({ category_id: 1, category_name: "A", total: "-50" }),
      mockCategory({ category_id: 2, category_name: "B", total: "-200" }),
    ]);
    expect(result.expenses[0].category_name).toBe("B");
  });

  it("limits top expense categories for compact breakdown", () => {
    const items = Array.from({ length: 9 }, (_, i) =>
      mockCategory({
        category_id: i + 1,
        category_name: `Cat ${i}`,
        total: String(-(100 - i)),
      })
    );
    expect(topExpenseCategories(items, 6)).toHaveLength(6);
    expect(topExpenseCategories(items, 6)[0].category_name).toBe("Cat 0");
  });
});

describe("reports navigation", () => {
  const filters = { monthKey: "2026-08", historyMonths: 12 as const };

  it("builds report detail path with month and history", () => {
    expect(reportDetailPath("spending", filters)).toEqual({
      pathname: "/reports/[type]",
      params: { type: "spending", month: "2026-08", months: "12" },
    });
  });

  it("builds spending limit performance deep link", () => {
    expect(reportDetailPath("spending", filters, { section: "limits" })).toEqual({
      pathname: "/reports/[type]",
      params: { type: "spending", month: "2026-08", months: "12", section: "limits" },
    });
  });

  it("builds category detail path", () => {
    expect(categoryDetailPath(12, filters, "Dining")).toEqual({
      pathname: "/reports/category/[categoryId]",
      params: { categoryId: "12", month: "2026-08", months: "12", name: "Dining" },
    });
  });

  it("builds transactions drill-down with category and date range", () => {
    expect(transactionsForReportCategory(12, "2026-08-01", "2026-08-31")).toEqual({
      pathname: "/(app)/(tabs)/transactions",
      params: { category: "12", dateFrom: "2026-08-01", dateTo: "2026-08-31" },
    });
  });

  it("builds goal and account drill-downs", () => {
    expect(reportGoalDetailPath(7)).toBe("/goal/7");
    expect(reportAccountDetailPath(42)).toBe("/account/42");
  });

  it("parses route params including limits section", () => {
    expect(parseReportRouteParams({ month: "2026-08", months: "6" })).toEqual({
      monthKey: "2026-08",
      historyMonths: 6,
      section: undefined,
    });
    expect(parseReportRouteParams({ month: "2026-08", months: "12", section: "limits" })).toEqual({
      monthKey: "2026-08",
      historyMonths: 12,
      section: "limits",
    });
    expect(parseReportRouteParams({ month: "bad" })).toBeNull();
  });
});

describe("reportsQueryKeys", () => {
  it("uses distinct keys for different filters", () => {
    const a = reportsQueryKeys.monthly("2026-08", 1, 12);
    const b = reportsQueryKeys.monthly("2026-07", 1, 12);
    const c = reportsQueryKeys.monthly("2026-08", 1, 6);
    expect(a).not.toEqual(b);
    expect(a).not.toEqual(c);
    expect(a).toEqual(["monthly-reports", "2026-08", 1, 12]);
  });

  it("reuses the same key for identical configuration", () => {
    const a = reportsQueryKeys.monthly("2026-08", 1, 12);
    const b = reportsQueryKeys.monthly("2026-08", 1, 12);
    expect(a).toEqual(b);
  });
});

describe("Reports information architecture", () => {
  it("exposes all five report types on landing and no budget report", async () => {
    const { REPORT_TYPE_CARDS } = await import("./types");
    const ids = REPORT_TYPE_CARDS.map((c) => c.id);
    expect(ids).toEqual(["overview", "cash-flow", "spending", "goals", "debt"]);
    expect(ids).not.toContain("budget");
  });

  it("keeps Reports under More, not as a primary tab destination invent", () => {
    expect(moreScreen).toMatch(/title: "Reports"/);
    expect(moreScreen).toMatch(/href: "\/reports"/);
  });

  it("uses compact Overview nav sections without View * link clutter", () => {
    expect(reportSections).toMatch(/ReportNavSection/);
    expect(reportSections).toMatch(/Spending limits/);
    expect(reportSections).not.toMatch(/View budget/);
    expect(reportSections).not.toMatch(/View spending/);
    expect(reportSections).not.toMatch(/View goals/);
    expect(reportSections).not.toMatch(/View debt/);
    expect(reportSections).not.toMatch(/View cash flow/);
    expect(reportSections).not.toMatch(/Open Budget/);
  });

  it("collapses spending limit performance and limits top categories", () => {
    expect(reportSections).toMatch(/CollapsibleReportSection/);
    expect(reportSections).toMatch(/Spending limit performance/);
    expect(reportSections).toMatch(/TOP_CATEGORY_LIMIT = 6/);
    expect(reportSections).toMatch(/Show all/);
  });

  it("preserves goal and debt drill-downs to detail screens", () => {
    expect(reportSections).toMatch(/reportGoalDetailPath/);
    expect(reportSections).toMatch(/reportAccountDetailPath/);
  });

  it("uses backend overview net and does not recompute net client-side", () => {
    expect(reportSections).toMatch(/overview\.net/);
    expect(reportSections).not.toMatch(/incomeSubtotal \+ expenseSubtotal/);
    expect(reportSections).not.toMatch(/total_income\s*-\s*total_expenses/);
    expect(reportsScreen).toMatch(/data\.overview\.net/);
  });

  it("uses backend expense_share_percent and show_comparison", () => {
    expect(categoryRow).toMatch(/expense_share_percent/);
    expect(categoryRow).toMatch(/show_comparison/);
    expect(categoryRow).not.toMatch(/expenseSharePercent\(/);
    expect(categoryRow).not.toMatch(/shouldShowCategoryDelta/);
  });
});

describe("Reports pull refresh and month-switch integrity", () => {
  it("uses explicit pullRefreshing, not passive isFetching, for RefreshControl", () => {
    expect(reportsScreen).toMatch(/pullRefreshing/);
    expect(reportsScreen).toMatch(/refreshing=\{pullRefreshing\}/);
    expect(reportsScreen).not.toMatch(/refreshing=\{isFetching && !isLoading\}/);
    expect(reportDetail).toMatch(/pullRefreshing/);
    expect(reportDetail).toMatch(/refreshing=\{pullRefreshing\}/);
    expect(reportDetail).not.toMatch(/refreshing=\{isFetching && !isLoading\}/);
  });

  it("awaits refetch before clearing pullRefreshing", () => {
    expect(reportsScreen).toMatch(/await refetch\(\)/);
    expect(reportsScreen).toMatch(/setPullRefreshing\(false\)/);
    expect(reportDetail).toMatch(/await refetch\(\)/);
  });

  it("labels month switches as updating and does not treat placeholder as current month", () => {
    expect(reportsScreen).toMatch(/dataMatchesMonth/);
    expect(reportsScreen).toMatch(/Updating/);
    expect(reportsScreen).toMatch(/isPlaceholderData/);
    expect(reportDetail).toMatch(/dataMatchesMonth/);
    expect(reportDetail).toMatch(/Updating/);
  });

  it("distinguishes error from empty data", () => {
    expect(reportsScreen).toMatch(/isError && !data/);
    expect(reportsScreen).toMatch(/ErrorState/);
    expect(reportDetail).toMatch(/isError && !data/);
  });
});
