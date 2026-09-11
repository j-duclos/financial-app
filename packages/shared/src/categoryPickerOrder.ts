import type { CategoryType } from "./types";

/**
 * Presentation-only order for transaction category pickers.
 * Does not change category IDs, types, saved transaction.category, reports, or budgets.
 */

const NONE_RANK = 1_000_000;
const CUSTOM_RANK = 10_000;

/** Everyday-first income names. Missing names are skipped. */
export const INCOME_CATEGORY_PICKER_PRIORITY = [
  "Paycheck / Salary",
  "Side Hustle",
  "Bonus",
  "Commission",
  "Tips",
  "Refunds / Reimbursements",
  "Gifts",
  "Business Income",
  "Rental Income",
  "Interest Income",
  "Dividends",
  "Other Income",
] as const;

/**
 * Everyday-first expense names using the seeded labels.
 * Housing / utilities / dining / transport come before infrequent items.
 * Names not listed (including custom categories) sort alphabetically afterward.
 */
export const EXPENSE_CATEGORY_PICKER_PRIORITY = [
  "Groceries",
  "Gas / Fuel",
  "Rent / Mortgage",
  "Electricity",
  "Water / Sewer",
  "Gas",
  "Trash",
  "Internet",
  "Mobile Phone",
  "Dining Out",
  "Coffee / Snacks",
  "Car Payment",
  "Maintenance",
  "Parking / Tolls",
  "Auto Insurance",
  "Home Insurance",
  "Health Insurance",
  "Doctor / Dentist",
  "Pharmacy",
  "Gym / Fitness",
  "Clothing",
  "Movies / Games",
  "Hobbies",
  "Streaming",
  "Software / Apps",
  "Memberships",
  "Pet Food",
  "Vet",
  "Supplies",
  "Personal Care",
  "Hair / Beauty",
  "Flights",
  "Lodging",
  "Transportation (Travel)",
  "Food (Travel)",
  "School / Activities",
  "Childcare",
  "Credit Card Payment",
  "Student Loan",
  "Personal Loan",
  "Federal Tax",
  "State Tax",
  "Other Tax",
  "Property Tax",
  "Other Expenses",
] as const;

const INCOME_RANK = rankMap(INCOME_CATEGORY_PICKER_PRIORITY);
const EXPENSE_RANK = rankMap(EXPENSE_CATEGORY_PICKER_PRIORITY);

function rankMap(names: readonly string[]): Map<string, number> {
  return new Map(names.map((name, index) => [name.trim().toLowerCase(), index]));
}

function compareNames(a: string, b: string): number {
  return a.localeCompare(b, undefined, { sensitivity: "base", numeric: true });
}

/** None / No category / Uncategorized picker rows belong at the bottom of the list. */
export function isNoneCategoryPickerLabel(name: string): boolean {
  const normalized = name.trim().toLowerCase();
  return (
    normalized === "none" ||
    normalized === "no category" ||
    normalized === "none / no category" ||
    normalized === "uncategorized"
  );
}

function pickerRank(name: string, type: CategoryType): number {
  if (isNoneCategoryPickerLabel(name)) return NONE_RANK;
  const table = type === "INCOME" ? INCOME_RANK : EXPENSE_RANK;
  const preferred = table.get(name.trim().toLowerCase());
  if (preferred != null) return preferred;
  return CUSTOM_RANK;
}

export function compareCategoryPickerNames(a: string, b: string, type: CategoryType): number {
  const rankA = pickerRank(a, type);
  const rankB = pickerRank(b, type);
  if (rankA !== rankB) return rankA - rankB;
  return compareNames(a, b);
}

/**
 * Sort named items for a category picker: preferred first, unknown/custom
 * alphabetically, None last. Returns a new array; does not mutate items.
 */
export function sortNamedItemsForCategoryPicker<T>(
  items: readonly T[],
  type: CategoryType,
  getName: (item: T) => string
): T[] {
  return [...items].sort((a, b) => compareCategoryPickerNames(getName(a), getName(b), type));
}

/** Preferred order for INCOME or EXPENSE category collections. */
export function sortCategoriesForPicker<T extends { name: string }>(
  categories: readonly T[],
  type: CategoryType
): T[] {
  return sortNamedItemsForCategoryPicker(categories, type, (category) => category.name);
}

export function matchesCategoryPickerSearch(name: string, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return name.toLowerCase().includes(needle);
}

/**
 * Search matching is independent of preferred order.
 * When a query is active, results are alphabetical (None still last).
 */
export function filterCategoriesForPickerSearch<T>(
  items: readonly T[],
  query: string,
  getName: (item: T) => string
): T[] {
  const matches = items.filter((item) => matchesCategoryPickerSearch(getName(item), query));
  if (!query.trim()) return matches;
  return [...matches].sort((a, b) => {
    const nameA = getName(a);
    const nameB = getName(b);
    const noneA = isNoneCategoryPickerLabel(nameA);
    const noneB = isNoneCategoryPickerLabel(nameB);
    if (noneA !== noneB) return noneA ? 1 : -1;
    return compareNames(nameA, nameB);
  });
}
