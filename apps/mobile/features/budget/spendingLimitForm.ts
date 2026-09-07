import type { Category, SpendingTargetPeriod, SpendingTargetType } from "@budget-app/shared";

export type SpendingLimitCategoryOption = {
  id: string;
  title: string;
  searchText: string;
};

export const SPENDING_LIMIT_PERIODS: { value: SpendingTargetPeriod; label: string }[] = [
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
  { value: "quarterly", label: "Quarterly" },
  { value: "yearly", label: "Yearly" },
];

export const SPENDING_TYPE_OPTIONS: {
  value: SpendingTargetType;
  label: string;
  helper: string;
}[] = [
  {
    value: "variable",
    label: "Variable",
    helper: "Posted spending plus known upcoming transactions.",
  },
  {
    value: "fixed",
    label: "Fixed / scheduled",
    helper: "Known bills and scheduled payments.",
  },
];

/** Expense categories for the limit picker — archived and duplicate names excluded. */
export function expenseCategoriesForLimitPicker(categories: Category[]): Category[] {
  const seen = new Set<string>();
  return categories
    .filter((c) => c.category_type === "EXPENSE" && !c.is_archived)
    .filter((c) => {
      const key = c.name.trim().toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true }));
}

export function spendingLimitCategoryPickerOptions(categories: Category[]): SpendingLimitCategoryOption[] {
  return expenseCategoriesForLimitPicker(categories).map((c) => ({
    id: String(c.id),
    title: c.name,
    searchText: c.name,
  }));
}

/** Local search over already-loaded picker options (same haystack as OptionsPickerSheet). */
export function filterSpendingLimitCategoryOptions(
  options: SpendingLimitCategoryOption[],
  query: string
): SpendingLimitCategoryOption[] {
  const q = query.trim().toLowerCase();
  if (!q) return options;
  return options.filter((opt) => {
    const hay = (opt.searchText ?? opt.title).toLowerCase();
    return hay.includes(q);
  });
}

export function normalizeLimitAmountInput(raw: string): string {
  const cleaned = raw.replace(/[^0-9.]/g, "");
  const parts = cleaned.split(".");
  if (parts.length <= 1) return cleaned;
  return `${parts[0]}.${parts.slice(1).join("").slice(0, 2)}`;
}

export function validateSpendingLimitAmount(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return "Limit amount is required.";
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) {
    return "Enter a valid amount (up to 2 decimal places).";
  }
  const n = Number(trimmed);
  if (!(n > 0)) return "Enter a positive amount.";
  return null;
}

export function validateSpendingLimitCategory(categoryId: number | ""): string | null {
  if (typeof categoryId !== "number") return "Select a category.";
  return null;
}
