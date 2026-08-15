import { describe, expect, it } from "vitest";
import type { Category } from "@budget-app/shared";
import {
  categoryRowActions,
  filterManagedCategories,
  groupManagedCategories,
  isDefaultCategory,
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
  const all = [dogFood, groceries, salary, archivedCustom];

  it("treats is_system as the default/source flag", () => {
    expect(isDefaultCategory(groceries)).toBe(true);
    expect(isDefaultCategory(dogFood)).toBe(false);
  });

  it("filters Expense vs Income", () => {
    const expense = filterManagedCategories(all, {
      type: "EXPENSE",
      source: "all",
      search: "",
      showArchived: false,
    });
    expect(expense.map((c) => c.name)).toEqual(["Dog Food", "Groceries"]);
    const income = filterManagedCategories(all, {
      type: "INCOME",
      source: "all",
      search: "",
      showArchived: false,
    });
    expect(income.map((c) => c.name)).toEqual(["Paycheck / Salary"]);
  });

  it("filters Custom vs Default", () => {
    const custom = filterManagedCategories(all, {
      type: "EXPENSE",
      source: "custom",
      search: "",
      showArchived: true,
    });
    expect(custom.map((c) => c.name)).toEqual(["Dog Food", "Old Club"]);
    const system = filterManagedCategories(all, {
      type: "EXPENSE",
      source: "default",
      search: "",
      showArchived: true,
    });
    expect(system.map((c) => c.name)).toEqual(["Groceries"]);
  });

  it("hides archived unless show archived is on", () => {
    const hidden = filterManagedCategories(all, {
      type: "EXPENSE",
      source: "all",
      search: "",
      showArchived: false,
    });
    expect(hidden.map((c) => c.name)).not.toContain("Old Club");
    const shown = filterManagedCategories(all, {
      type: "EXPENSE",
      source: "all",
      search: "",
      showArchived: true,
    });
    expect(shown.map((c) => c.name)).toContain("Old Club");
  });

  it("searches by name together with the other filters", () => {
    const found = filterManagedCategories(all, {
      type: "EXPENSE",
      source: "custom",
      search: "dog",
      showArchived: true,
    });
    expect(found.map((c) => c.name)).toEqual(["Dog Food"]);
  });

  it("groups custom before default without empty arrays mixed in", () => {
    const filtered = filterManagedCategories(all, {
      type: "EXPENSE",
      source: "all",
      search: "",
      showArchived: false,
    });
    expect(groupManagedCategories(filtered)).toEqual({
      custom: [dogFood],
      system: [groceries],
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
});
