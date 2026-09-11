import { describe, expect, it } from "vitest";
import {
  EXPENSE_CATEGORY_PICKER_PRIORITY,
  INCOME_CATEGORY_PICKER_PRIORITY,
  filterCategoriesForPickerSearch,
  isNoneCategoryPickerLabel,
  sortCategoriesForPicker,
  sortNamedItemsForCategoryPicker,
} from "./categoryPickerOrder";

function cat(name: string, extras: { id?: number; category_type?: "INCOME" | "EXPENSE" } = {}) {
  return {
    id: extras.id ?? name.length,
    name,
    category_type: extras.category_type ?? "INCOME",
  };
}

describe("sortCategoriesForPicker — income", () => {
  it("starts with Paycheck / Salary, Side Hustle, Bonus and ends Other Income then None", () => {
    const none = cat("None", { id: 0 });
    const other = cat("Other Income", { id: 12 });
    const bonus = cat("Bonus", { id: 3 });
    const paycheck = cat("Paycheck / Salary", { id: 1 });
    const side = cat("Side Hustle", { id: 2 });
    const tips = cat("Tips", { id: 5 });

    const ordered = sortCategoriesForPicker(
      [none, other, bonus, tips, paycheck, side],
      "INCOME"
    );

    expect(ordered.map((c) => c.name).slice(0, 3)).toEqual([
      "Paycheck / Salary",
      "Side Hustle",
      "Bonus",
    ]);
    expect(ordered.map((c) => c.name).slice(-2)).toEqual(["Other Income", "None"]);
    expect(ordered[0]).toBe(paycheck);
    expect(ordered[0].id).toBe(1);
  });

  it("skips preferred names that are not in the collection", () => {
    const ordered = sortCategoriesForPicker(
      [cat("Bonus"), cat("Paycheck / Salary"), cat("Gifts")],
      "INCOME"
    );
    expect(ordered.map((c) => c.name)).toEqual(["Paycheck / Salary", "Bonus", "Gifts"]);
  });

  it("places unknown/custom income categories after preferred names, alphabetically", () => {
    const ordered = sortCategoriesForPicker(
      [
        cat("Zelle"),
        cat("Other Income"),
        cat("Apple Pay Gigs"),
        cat("Paycheck / Salary"),
        cat("None"),
      ],
      "INCOME"
    );
    expect(ordered.map((c) => c.name)).toEqual([
      "Paycheck / Salary",
      "Other Income",
      "Apple Pay Gigs",
      "Zelle",
      "None",
    ]);
  });
});

describe("sortCategoriesForPicker — expense", () => {
  it("puts everyday expense names before infrequent and custom ones", () => {
    expect(EXPENSE_CATEGORY_PICKER_PRIORITY.slice(0, 3)).toEqual([
      "Groceries",
      "Gas / Fuel",
      "Rent / Mortgage",
    ]);

    const ordered = sortCategoriesForPicker(
      [
        cat("HOA", { category_type: "EXPENSE" }),
        cat("Other Expenses", { category_type: "EXPENSE" }),
        cat("Groceries", { category_type: "EXPENSE" }),
        cat("Bank Fees", { category_type: "EXPENSE" }),
        cat("Dining Out", { category_type: "EXPENSE" }),
        cat("Savor", { category_type: "EXPENSE" }),
        cat("Gas / Fuel", { category_type: "EXPENSE" }),
        cat("None", { category_type: "EXPENSE" }),
      ],
      "EXPENSE"
    );

    expect(ordered.map((c) => c.name)).toEqual([
      "Groceries",
      "Gas / Fuel",
      "Dining Out",
      "Other Expenses",
      "Bank Fees",
      "HOA",
      "Savor",
      "None",
    ]);
  });
});

describe("custom categories, None, and identity", () => {
  it("does not mutate category objects or IDs", () => {
    const paycheck = cat("Paycheck / Salary", { id: 41 });
    const custom = cat("Consulting", { id: 99 });
    const input = [custom, paycheck];
    const snapshot = input.map((c) => ({ ...c }));

    const ordered = sortCategoriesForPicker(input, "INCOME");

    expect(input.map((c) => c.name)).toEqual(["Consulting", "Paycheck / Salary"]);
    expect(input.map((c) => c.id)).toEqual([99, 41]);
    expect(input[0]).toEqual(snapshot[0]);
    expect(ordered[0]).toBe(paycheck);
    expect(ordered[0].id).toBe(41);
    expect(ordered[1]).toBe(custom);
    expect(ordered[1].id).toBe(99);
  });

  it("treats None / No category / Uncategorized as last", () => {
    expect(isNoneCategoryPickerLabel("None")).toBe(true);
    expect(isNoneCategoryPickerLabel("No category")).toBe(true);
    expect(isNoneCategoryPickerLabel("Uncategorized")).toBe(true);

    const ordered = sortNamedItemsForCategoryPicker(
      [{ title: "None" }, { title: "Paycheck / Salary" }, { title: "No category" }],
      "INCOME",
      (item) => item.title
    );
    expect(ordered.map((item) => item.title)).toEqual([
      "Paycheck / Salary",
      "No category",
      "None",
    ]);
  });
});

describe("category picker search", () => {
  it("returns categories regardless of preferred position", () => {
    const ordered = sortCategoriesForPicker(
      [
        cat("None"),
        cat("Other Income"),
        cat("Zelle"),
        cat("Paycheck / Salary"),
        cat("Side Hustle"),
        cat("Bonus"),
      ],
      "INCOME"
    );

    const paycheckHits = filterCategoriesForPickerSearch(ordered, "paycheck", (c) => c.name);
    expect(paycheckHits.map((c) => c.name)).toEqual(["Paycheck / Salary"]);

    const noneHits = filterCategoriesForPickerSearch(ordered, "none", (c) => c.name);
    expect(noneHits.map((c) => c.name)).toEqual(["None"]);

    const otherHits = filterCategoriesForPickerSearch(ordered, "other", (c) => c.name);
    expect(otherHits.map((c) => c.name)).toEqual(["Other Income"]);
  });

  it("uses alphabetical order while searching", () => {
    const items = [
      cat("Paycheck / Salary"),
      cat("Tips"),
      cat("Bonus"),
      cat("Business Income"),
    ];
    const hits = filterCategoriesForPickerSearch(items, "i", (c) => c.name);
    expect(hits.map((c) => c.name)).toEqual(["Business Income", "Tips"]);
  });
});

describe("preferred lists", () => {
  it("keeps the specified income sequence", () => {
    expect(INCOME_CATEGORY_PICKER_PRIORITY.slice(0, 3)).toEqual([
      "Paycheck / Salary",
      "Side Hustle",
      "Bonus",
    ]);
    expect(INCOME_CATEGORY_PICKER_PRIORITY.at(-1)).toBe("Other Income");
  });
});
