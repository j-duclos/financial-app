import { describe, expect, it } from "vitest";
import type { Category } from "@budget-app/shared";
import {
  categoryRowActions,
  categoryRowSubtitle,
  categoryTypeLabel,
  filterCategoriesForManagement,
  filterManagedCategories,
  groupCategoriesByType,
  groupManagedCategories,
  isDefaultCategory,
  matchesCategorySearch,
  parentOptionsForType,
  validateCategoryName,
} from "./categoryList";

function cat(overrides: Partial<Category> = {}): Category {
  return {
    id: 1,
    household: 1,
    parent: null,
    name: "Groceries",
    category_type: "EXPENSE",
    is_system: true,
    is_archived: false,
    sort_order: 0,
    created_at: "",
    updated_at: "",
    ...overrides,
  };
}

describe("categoryList", () => {
  const dogFood = cat({ id: 1, name: "Dog Food", is_system: false });
  const groceries = cat({ id: 2, name: "Groceries", is_system: true });
  const salary = cat({ id: 3, name: "Paycheck / Salary", category_type: "INCOME", is_system: true });
  const archivedCustom = cat({ id: 4, name: "Old Club", is_system: false, is_archived: true });
  const transfer = cat({ id: 5, name: "Transfer", is_system: true });
  const all = [dogFood, groceries, salary, archivedCustom, transfer];

  it("treats is_system as the default/source flag", () => {
    expect(isDefaultCategory(groceries)).toBe(true);
    expect(isDefaultCategory(dogFood)).toBe(false);
  });

  it("labels category types for display", () => {
    expect(categoryTypeLabel("EXPENSE")).toBe("Expense");
    expect(categoryTypeLabel("INCOME")).toBe("Income");
  });

  it("builds row subtitle with type, default, and archived status", () => {
    expect(categoryRowSubtitle(dogFood)).toBe("Expense");
    expect(categoryRowSubtitle(groceries)).toBe("Expense · Default");
    expect(categoryRowSubtitle(archivedCustom)).toBe("Expense · Archived");
    expect(categoryRowSubtitle(salary)).toBe("Income · Default");
  });

  it("filters Expense vs Income", () => {
    const expense = filterManagedCategories(all, {
      type: "EXPENSE",
      source: "all",
      search: "",
      showArchived: false,
    });
    expect(expense.map((c) => c.name)).toEqual(["Dog Food", "Groceries", "Transfer"]);
    const income = filterManagedCategories(all, {
      type: "INCOME",
      source: "all",
      search: "",
      showArchived: false,
    });
    expect(income.map((c) => c.name)).toEqual(["Paycheck / Salary"]);
  });

  it("hides archived unless show archived is on", () => {
    const hidden = filterCategoriesForManagement(all, { search: "", showArchived: false });
    expect(hidden.map((c) => c.name)).not.toContain("Old Club");
    const shown = filterCategoriesForManagement(all, { search: "", showArchived: true });
    expect(shown.map((c) => c.name)).toContain("Old Club");
  });

  it("searches locally by name without requiring server round-trips", () => {
    expect(matchesCategorySearch(dogFood, "dog")).toBe(true);
    expect(matchesCategorySearch(dogFood, "rent")).toBe(false);
    const found = filterCategoriesForManagement(all, { search: "dog", showArchived: true });
    expect(found.map((c) => c.name)).toEqual(["Dog Food"]);
  });

  it("groups management list by type for section headers", () => {
    const filtered = filterCategoriesForManagement(all, { search: "", showArchived: false });
    expect(groupCategoriesByType(filtered)).toEqual({
      expense: [dogFood, groceries, transfer],
      income: [salary],
    });
  });

  it("groups custom vs default when source filtering is used", () => {
    const filtered = filterManagedCategories(all, {
      type: "EXPENSE",
      source: "all",
      search: "",
      showArchived: false,
    });
    expect(groupManagedCategories(filtered)).toEqual({
      custom: [dogFood],
      system: [groceries, transfer],
    });
  });

  it("exposes restore instead of archive for archived rows", () => {
    expect(categoryRowActions(dogFood)).toEqual({
      edit: true,
      archive: true,
      restore: false,
      delete: true,
    });
    expect(categoryRowActions(archivedCustom)).toEqual({
      edit: true,
      archive: false,
      restore: true,
      delete: true,
    });
  });

  it("allows edit/archive/delete for system defaults (matches web/backend)", () => {
    expect(categoryRowActions(transfer)).toEqual({
      edit: true,
      archive: true,
      restore: false,
      delete: true,
    });
  });

  it("validates name length like the backend serializer", () => {
    expect(validateCategoryName("")).toBe("Name must be at least 2 characters.");
    expect(validateCategoryName("A")).toBe("Name must be at least 2 characters.");
    expect(validateCategoryName("  Ab  ")).toBeNull();
  });

  it("lists active root parents of matching type and excludes self", () => {
    const childParent = cat({ id: 10, name: "Food", is_system: false, parent: null });
    const nested = cat({ id: 11, name: "Dining", is_system: false, parent: 10 });
    const incomeRoot = cat({ id: 12, name: "Bonus", category_type: "INCOME", is_system: false });
    const opts = parentOptionsForType([childParent, nested, incomeRoot, archivedCustom], "EXPENSE", 10);
    expect(opts.map((c) => c.id)).toEqual([]);
    const optsCreate = parentOptionsForType([childParent, nested, incomeRoot, archivedCustom], "EXPENSE");
    expect(optsCreate.map((c) => c.name)).toEqual(["Food"]);
  });
});
