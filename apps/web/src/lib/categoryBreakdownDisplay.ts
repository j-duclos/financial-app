import type { CategoryBreakdownItem } from "@budget-app/shared";

/** Internal account moves — not real income or spending in reports. */
export const INTERNAL_TRANSFER_CATEGORY_NAMES = new Set(["Bank Transfer", "Transfer"]);

export type PartitionedCategoryBreakdown = {
  income: CategoryBreakdownItem[];
  expenses: CategoryBreakdownItem[];
  incomeSubtotal: number;
  expenseSubtotal: number;
  net: number;
};

function byCategoryName(a: CategoryBreakdownItem, b: CategoryBreakdownItem): number {
  return a.category_name.localeCompare(b.category_name);
}

export function partitionCategoryBreakdown(items: CategoryBreakdownItem[]): PartitionedCategoryBreakdown {
  const income: CategoryBreakdownItem[] = [];
  const expenses: CategoryBreakdownItem[] = [];

  for (const row of items) {
    if (INTERNAL_TRANSFER_CATEGORY_NAMES.has(row.category_name)) {
      continue;
    }
    if (parseFloat(row.total) >= 0) {
      income.push(row);
    } else {
      expenses.push(row);
    }
  }

  income.sort(byCategoryName);
  expenses.sort(byCategoryName);

  const incomeSubtotal = income.reduce((sum, row) => sum + parseFloat(row.total), 0);
  const expenseSubtotal = expenses.reduce((sum, row) => sum + parseFloat(row.total), 0);

  return {
    income,
    expenses,
    incomeSubtotal,
    expenseSubtotal,
    net: incomeSubtotal + expenseSubtotal,
  };
}
