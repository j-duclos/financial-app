import type { CategoryBreakdownItem } from "@budget-app/shared";
import { parseOptionalAmount } from "./reportDisplay";

/** Internal account moves — not real income or spending in reports. */
export const INTERNAL_TRANSFER_CATEGORY_NAMES = new Set(["Bank Transfer", "Transfer"]);

export type PartitionedCategoryBreakdown = {
  income: CategoryBreakdownItem[];
  expenses: CategoryBreakdownItem[];
};

function byExpenseAmount(a: CategoryBreakdownItem, b: CategoryBreakdownItem): number {
  const aN = parseOptionalAmount(a.total) ?? 0;
  const bN = parseOptionalAmount(b.total) ?? 0;
  return aN - bN;
}

function byCategoryName(a: CategoryBreakdownItem, b: CategoryBreakdownItem): number {
  return a.category_name.localeCompare(b.category_name);
}

/**
 * Split breakdown rows into income/expense lists for presentation.
 * Does not compute financial subtotals — use overview.total_income / total_expenses / net.
 * Prefer backend order when present; expenses still surface most-negative first for UI lists.
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
  expenses.sort(byExpenseAmount);

  return { income, expenses };
}

export function topExpenseCategories(
  items: CategoryBreakdownItem[],
  limit = 6
): CategoryBreakdownItem[] {
  return partitionCategoryBreakdown(items).expenses.slice(0, limit);
}
