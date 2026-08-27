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
  expenseSharePercent,
  formatDeltaVsPrevious,
  formatSignedAmount,
  parseReportTypeParam,
  shouldShowCategoryDelta,
} from "./reportDisplay";
import type { CategoryBreakdownItem } from "@budget-app/shared";

const dir = dirname(fileURLToPath(import.meta.url));
const reportSections = readFileSync(join(dir, "components/ReportSections.tsx"), "utf8");
const moreScreen = readFileSync(
  join(dir, "../more/MoreScreen.tsx"),
  "utf8"
);

function mockCategory(overrides: Partial<CategoryBreakdownItem> = {}): CategoryBreakdownItem {
  return {
    category_id: 1,
    category_name: "Groceries",
    total: "-120.00",
    previous_total: "-100.00",
    delta: "-20.00",
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

  it("hides tiny category comparisons", () => {
    expect(shouldShowCategoryDelta("-5", "1", 5000)).toBe(false);
    expect(shouldShowCategoryDelta("-812", "-94", 5000)).toBe(true);
  });

  it("parses report type route params", () => {
    expect(parseReportTypeParam("spending")).toBe("spending");
    expect(parseReportTypeParam("cash-flow")).toBe("cash-flow");
    expect(parseReportTypeParam("cash_flow")).toBe("cash-flow");
    expect(parseReportTypeParam("unknown")).toBeNull();
    expect(parseReportTypeParam("budget")).toBeNull();
  });

  it("computes expense share percentages", () => {
    expect(expenseSharePercent("-500", 1000)).toBe("50%");
    expect(expenseSharePercent("-5", 1000)).toBe("<1%");
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
  it("partitions income and expenses and excludes transfer categories", () => {
    const result = partitionCategoryBreakdown([
      mockCategory({ category_name: "Salary", total: "3000", category_id: 2 }),
      mockCategory(),
      mockCategory({ category_name: "Transfer", total: "-500", category_id: 3 }),
      mockCategory({ category_name: "Bank Transfer", total: "-100", category_id: 4 }),
      mockCategory({ category_name: "Uncategorized", total: "-40", category_id: null }),
    ]);

    expect(result.income).toHaveLength(1);
    expect(result.expenses).toHaveLength(2);
    expect(result.expenseSubtotal).toBe(-160);
    expect(result.net).toBe(3000 - 160);
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
});
