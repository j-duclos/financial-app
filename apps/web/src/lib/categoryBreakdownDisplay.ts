import type { CategoryBreakdownItem } from "@budget-app/shared";
import { parseOptionalAmount } from "./reportDisplay";

/** Internal account moves — not real income or spending in reports. */
export const INTERNAL_TRANSFER_CATEGORY_NAMES = new Set(["Bank Transfer", "Transfer"]);

export type PartitionedCategoryBreakdown = {
  income: CategoryBreakdownItem[];
  expenses: CategoryBreakdownItem[];
};

function byCategoryName(a: CategoryBreakdownItem, b: CategoryBreakdownItem): number {
  return a.category_name.localeCompare(b.category_name);
}

/**
 * Split breakdown rows into income/expense lists for presentation.
 * Does not compute financial subtotals — use overview totals from the API.
 */
export function partitionCategoryBreakdown(items: CategoryBreakdownItem[]): PartitionedCategoryBreakdown {
  const income: CategoryBreakdownItem[] = [];
  const expenses: CategoryBreakdownItem[] = [];

  for (const row of items) {
    if (INTERNAL_TRANSFER_CATEGORY_NAMES.has(row.category_name)) {
      continue;
    }
    const total = parseOptionalAmount(row.total);
    if (total == null) continue;
    if (total >= 0) {
      income.push(row);
    } else {
      expenses.push(row);
    }
  }

  income.sort(byCategoryName);
  expenses.sort(byCategoryName);

  return { income, expenses };
}
