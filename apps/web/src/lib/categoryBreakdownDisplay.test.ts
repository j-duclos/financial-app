import { describe, expect, it } from "vitest";
import { partitionCategoryBreakdown } from "./categoryBreakdownDisplay";
import type { CategoryBreakdownItem } from "@budget-app/shared";

function row(name: string, total: string, id: number | null = 1): CategoryBreakdownItem {
  return { category_id: id, category_name: name, total };
}

describe("partitionCategoryBreakdown", () => {
  it("splits income and expenses, sorts by name, and computes subtotals and net", () => {
    const items: CategoryBreakdownItem[] = [
      row("Uncategorized", "-2488.92", null),
      row("Paycheck / Salary", "7342.08", 2),
      row("Rent / Mortgage", "-3100.00", 3),
      row("Bank Transfer", "0.00", 4),
    ];

    const result = partitionCategoryBreakdown(items);

    expect(result.income.map((r) => r.category_name)).toEqual(["Paycheck / Salary"]);
    expect(result.expenses.map((r) => r.category_name)).toEqual(["Rent / Mortgage", "Uncategorized"]);
    expect(result.incomeSubtotal).toBeCloseTo(7342.08);
    expect(result.expenseSubtotal).toBeCloseTo(-5588.92);
    expect(result.net).toBeCloseTo(1753.16);
  });

  it("drops internal transfer categories", () => {
    const result = partitionCategoryBreakdown([
      row("Paycheck / Salary", "100.00"),
      row("Bank Transfer", "500.00"),
      row("Transfer", "-500.00"),
    ]);
    expect(result.income).toHaveLength(1);
    expect(result.expenses).toHaveLength(0);
    expect(result.incomeSubtotal).toBeCloseTo(100);
  });
});
