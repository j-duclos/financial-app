import { describe, expect, it } from "vitest";
import type { Category } from "@budget-app/shared";
import { filterCategoriesForPickerSearch } from "@budget-app/shared";
import { categoryPickerOptions } from "./categoryPickerOptions";

function cat(id: number, name: string, type: Category["category_type"] = "EXPENSE"): Category {
  return {
    id,
    household: 1,
    parent: null,
    name,
    category_type: type,
    is_system: false,
    is_archived: false,
    sort_order: 0,
    created_at: "",
    updated_at: "",
  };
}

describe("categoryPickerOptions", () => {
  it("uses preferred income order and places None last without mutating IDs", () => {
    const paycheck = cat(11, "Paycheck / Salary", "INCOME");
    const side = cat(12, "Side Hustle", "INCOME");
    const custom = cat(99, "Consulting", "INCOME");
    const expense = cat(4, "Groceries", "EXPENSE");
    const input = [custom, expense, side, paycheck];

    const options = categoryPickerOptions(input, "INCOME");

    expect(options.map((o) => o.title)).toEqual([
      "Paycheck / Salary",
      "Side Hustle",
      "Consulting",
      "None",
    ]);
    expect(options.map((o) => o.id)).toEqual(["11", "12", "99", ""]);
    expect(paycheck.id).toBe(11);
    expect(custom.id).toBe(99);
    expect(input[0]).toBe(custom);
  });

  it("keeps None searchable even though it is last", () => {
    const options = categoryPickerOptions(
      [cat(1, "Bonus", "INCOME"), cat(2, "Paycheck / Salary", "INCOME")],
      "INCOME"
    );
    const hits = filterCategoriesForPickerSearch(options, "none", (o) => o.title);
    expect(hits.map((o) => o.title)).toEqual(["None"]);
    expect(filterCategoriesForPickerSearch(options, "pay", (o) => o.title).map((o) => o.id)).toEqual([
      "2",
    ]);
  });
});
