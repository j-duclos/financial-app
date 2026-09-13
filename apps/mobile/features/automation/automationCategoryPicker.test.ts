import { describe, expect, it } from "vitest";
import type { Category } from "@budget-app/shared";
import {
  ANY_CATEGORY_ID,
  ANY_CATEGORY_LABEL,
  automationCategoryFieldValue,
  automationCategoryPickerOptions,
  filterAutomationCategoryOptions,
  serializeAutomationCategoryId,
} from "./automationCategoryPicker";

function cat(
  id: number,
  name: string,
  type: Category["category_type"] = "EXPENSE",
  extra: Partial<Category> = {}
): Category {
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
    ...extra,
  };
}

describe("automationCategoryPickerOptions", () => {
  it("puts Any category first and keeps custom categories from the real list", () => {
    const custom = cat(99, "Dog Treats");
    const groceries = cat(1, "Groceries");
    const income = cat(2, "Paycheck / Salary", "INCOME");
    const archived = cat(3, "Old Stuff", "EXPENSE", { is_archived: true });

    const options = automationCategoryPickerOptions([custom, groceries, income, archived], "EXPENSE");

    expect(options[0]).toMatchObject({
      id: ANY_CATEGORY_ID,
      title: ANY_CATEGORY_LABEL,
      pinned: true,
    });
    expect(options.map((o) => o.title)).toEqual([ANY_CATEGORY_LABEL, "Groceries", "Dog Treats"]);
    expect(options.find((o) => o.title === "Dog Treats")?.id).toBe("99");
    expect(options.some((o) => o.title === "Paycheck / Salary")).toBe(false);
    expect(options.some((o) => o.title === "Old Stuff")).toBe(false);
  });

  it("defaults the collapsed field to Any category and shows a selected name", () => {
    expect(automationCategoryFieldValue(null)).toBe(ANY_CATEGORY_LABEL);
    expect(automationCategoryFieldValue(undefined)).toBe(ANY_CATEGORY_LABEL);
    expect(automationCategoryFieldValue("Streaming")).toBe("Streaming");
  });

  it("serializes Any category as the existing null category_id condition", () => {
    expect(serializeAutomationCategoryId(ANY_CATEGORY_ID)).toBeNull();
    expect(serializeAutomationCategoryId("42")).toBe(42);
  });

  it("filters case-insensitively and keeps Any category first when it matches", () => {
    const options = automationCategoryPickerOptions(
      [cat(1, "Groceries"), cat(99, "Dog Treats"), cat(7, "Gas / Fuel")],
      "EXPENSE"
    );

    const groceries = filterAutomationCategoryOptions(options, "GROC");
    expect(groceries.map((o) => o.title)).toEqual(["Groceries"]);

    const anyHits = filterAutomationCategoryOptions(options, "any");
    expect(anyHits[0]?.title).toBe(ANY_CATEGORY_LABEL);

    const custom = filterAutomationCategoryOptions(options, "dog");
    expect(custom.map((o) => o.title)).toEqual(["Dog Treats"]);
  });
});
