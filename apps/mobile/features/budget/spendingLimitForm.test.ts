import { describe, expect, it } from "vitest";
import type { Category } from "@budget-app/shared";
import {
  SPENDING_LIMIT_PERIODS,
  SPENDING_TYPE_OPTIONS,
  expenseCategoriesForLimitPicker,
  filterSpendingLimitCategoryOptions,
  normalizeLimitAmountInput,
  spendingLimitCategoryPickerOptions,
  validateSpendingLimitAmount,
  validateSpendingLimitCategory,
} from "./spendingLimitForm";

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

describe("expenseCategoriesForLimitPicker", () => {
  const groceries = cat({ id: 1, name: "Groceries" });
  const savor = cat({ id: 2, name: "Savor" });
  const salary = cat({ id: 3, name: "Paycheck", category_type: "INCOME" });
  const archived = cat({ id: 4, name: "Old Club", is_archived: true });
  const groceriesDup = cat({ id: 5, name: "Groceries" });
  const careCredit = cat({ id: 6, name: "Care Credit" });

  it("keeps expense categories only, excludes archived, de-duplicates names, and sorts alphabetically", () => {
    const result = expenseCategoriesForLimitPicker([
      savor,
      salary,
      archived,
      groceriesDup,
      groceries,
      careCredit,
    ]);
    expect(result.map((c) => c.name)).toEqual(["Care Credit", "Groceries", "Savor"]);
    expect(result.map((c) => c.id)).toEqual([6, 5, 2]);
  });
});

describe("spendingLimitCategoryPickerOptions", () => {
  it("builds searchable picker options from the filtered category list", () => {
    const options = spendingLimitCategoryPickerOptions([
      cat({ id: 9, name: "Credit Card Payment" }),
      cat({ id: 2, name: "Salary", category_type: "INCOME" }),
      cat({ id: 3, name: "Archived", is_archived: true }),
    ]);
    expect(options).toEqual([
      { id: "9", title: "Credit Card Payment", searchText: "Credit Card Payment" },
    ]);
  });

  it("filters locally by search text over loaded options", () => {
    const options = spendingLimitCategoryPickerOptions([
      cat({ id: 1, name: "Groceries" }),
      cat({ id: 2, name: "Credit Card Payment" }),
      cat({ id: 3, name: "Dining" }),
    ]);
    expect(filterSpendingLimitCategoryOptions(options, "card").map((o) => o.title)).toEqual([
      "Credit Card Payment",
    ]);
    expect(filterSpendingLimitCategoryOptions(options, "  GROC  ").map((o) => o.id)).toEqual(["1"]);
    expect(filterSpendingLimitCategoryOptions(options, "zzz")).toEqual([]);
  });
});

describe("limit amount validation", () => {
  it("requires a positive amount with at most 2 decimal places", () => {
    expect(validateSpendingLimitAmount("")).toBe("Limit amount is required.");
    expect(validateSpendingLimitAmount("   ")).toBe("Limit amount is required.");
    expect(validateSpendingLimitAmount("0")).toBe("Enter a positive amount.");
    expect(validateSpendingLimitAmount("0.00")).toBe("Enter a positive amount.");
    expect(validateSpendingLimitAmount("12.345")).toBe("Enter a valid amount (up to 2 decimal places).");
    expect(validateSpendingLimitAmount("abc")).toBe("Enter a valid amount (up to 2 decimal places).");
    expect(validateSpendingLimitAmount("450.00")).toBeNull();
    expect(validateSpendingLimitAmount("1")).toBeNull();
  });

  it("normalizes typed input to digits and 2 decimal places without changing stored semantics", () => {
    expect(normalizeLimitAmountInput("$450.00")).toBe("450.00");
    expect(normalizeLimitAmountInput("12.3499")).toBe("12.34");
    expect(normalizeLimitAmountInput("12.3")).toBe("12.3");
  });
});

describe("category required validation", () => {
  it("requires a selected category", () => {
    expect(validateSpendingLimitCategory("")).toBe("Select a category.");
    expect(validateSpendingLimitCategory(9)).toBeNull();
  });
});

describe("period and spending-type options", () => {
  it("preserves weekly/monthly/quarterly/yearly", () => {
    expect(SPENDING_LIMIT_PERIODS.map((p) => p.value)).toEqual([
      "weekly",
      "monthly",
      "quarterly",
      "yearly",
    ]);
  });

  it("preserves variable and fixed/scheduled with backend-aligned helpers", () => {
    expect(SPENDING_TYPE_OPTIONS.map((o) => o.value)).toEqual(["variable", "fixed"]);
    expect(SPENDING_TYPE_OPTIONS[0].label).toBe("Variable");
    expect(SPENDING_TYPE_OPTIONS[1].label).toBe("Fixed / scheduled");
    expect(SPENDING_TYPE_OPTIONS[0].helper).toBe(
      "Posted spending plus known upcoming transactions."
    );
    expect(SPENDING_TYPE_OPTIONS[1].helper).toBe("Known bills and scheduled payments.");
  });
});
