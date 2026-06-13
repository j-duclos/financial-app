import { describe, expect, it } from "vitest";
import type { Category } from "@budget-app/shared";
import { categoriesForDropdown, dedupeCategories } from "./categoryOptions";

function cat(id: number, name: string, overrides: Partial<Category> = {}): Category {
  return {
    id,
    household: 1,
    name,
    category_type: "EXPENSE",
    parent: null,
    is_system: true,
    is_archived: false,
    sort_order: 0,
    created_at: "",
    updated_at: "",
    ...overrides,
  };
}

describe("categoryOptions", () => {
  it("dedupes categories with the same name and type", () => {
    const rows = [cat(79, "ATM / Cash Fees"), cat(1102, "ATM / Cash Fees")];
    expect(dedupeCategories(rows).map((c) => c.id)).toEqual([79]);
  });

  it("keeps distinct types with the same name", () => {
    const rows = [
      cat(1, "Gifts", { category_type: "INCOME" }),
      cat(2, "Gifts", { category_type: "EXPENSE" }),
    ];
    expect(dedupeCategories(rows).map((c) => c.id).sort()).toEqual([1, 2]);
  });

  it("sorts dropdown options alphabetically", () => {
    const rows = [cat(3, "Zebra"), cat(1, "Auto Insurance"), cat(2, "ATM / Cash Fees")];
    expect(categoriesForDropdown(rows).map((c) => c.label)).toEqual([
      "ATM / Cash Fees",
      "Auto Insurance",
      "Zebra",
    ]);
  });
});
