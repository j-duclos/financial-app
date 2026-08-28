import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import {
  categoriesListPath,
  categoryCreatePath,
  categoryEditPath,
} from "./navigation";
import {
  categoriesQueryKeys,
  invalidateAfterCategoryMutation,
} from "./queryKeys";

const dir = dirname(fileURLToPath(import.meta.url));

const categoriesScreenSource = readFileSync(join(dir, "CategoriesScreen.tsx"), "utf8");
const categoryFormSource = readFileSync(join(dir, "CategoryFormScreen.tsx"), "utf8");
const categoryRowSource = readFileSync(join(dir, "CategoryRow.tsx"), "utf8");
const queryKeysSource = readFileSync(join(dir, "queryKeys.ts"), "utf8");
const categoriesRoute = readFileSync(join(dir, "../../app/(app)/categories.tsx"), "utf8");
const categoriesNewRoute = readFileSync(join(dir, "../../app/(app)/categories/new.tsx"), "utf8");
const categoriesEditRoute = readFileSync(
  join(dir, "../../app/(app)/categories/edit/[id].tsx"),
  "utf8"
);
const moreScreenSource = readFileSync(join(dir, "../more/MoreScreen.tsx"), "utf8");
const transactionFormSource = readFileSync(
  join(dir, "../transactions/TransactionFormScreen.tsx"),
  "utf8"
);
const recurringFormSource = readFileSync(join(dir, "../recurring/RecurringFormScreen.tsx"), "utf8");
const spendingLimitFormSource = readFileSync(
  join(dir, "../budget/SpendingLimitFormScreen.tsx"),
  "utf8"
);
const whatIfDataSource = readFileSync(join(dir, "../what-if/useWhatIfData.ts"), "utf8");
const automationFormSource = readFileSync(
  join(dir, "../automation/AutomationFormScreen.tsx"),
  "utf8"
);
const financialRefreshSource = readFileSync(
  join(dir, "../../lib/financialQueryRefresh.ts"),
  "utf8"
);

describe("Categories routes and placeholder removal", () => {
  it("categories route no longer uses PlaceholderScreen", () => {
    expect(categoriesRoute).not.toMatch(/PlaceholderScreen/);
    expect(categoriesRoute).not.toMatch(/coming soon/i);
    expect(categoriesRoute).toMatch(/CategoriesScreen/);
  });

  it("create and edit routes use CategoryFormScreen", () => {
    expect(categoriesNewRoute).toMatch(/CategoryFormScreen/);
    expect(categoriesEditRoute).toMatch(/CategoryFormScreen/);
  });

  it("remains a secondary More destination, not a tab", () => {
    expect(moreScreenSource).toMatch(
      /title: "Categories", href: "\/categories", subtitle: "Income and expense categories"/
    );
    expect(moreScreenSource).not.toMatch(
      /title: "Categories".*Web only for beta/
    );
    expect(categoriesListPath()).toBe("/categories");
  });
});

describe("Categories list presentation", () => {
  it("uses a searchable FlatList with type section headers, not a chip wall", () => {
    expect(categoriesScreenSource).toMatch(/FlatList/);
    expect(categoriesScreenSource).toMatch(/Search categories/);
    expect(categoriesScreenSource).toMatch(/Expense/);
    expect(categoriesScreenSource).toMatch(/Income/);
    expect(categoriesScreenSource).not.toMatch(/ChipSection|chip wall|flexWrap.*categories/i);
    expect(categoryRowSource).toMatch(/CategoryRow/);
  });

  it("creates via header plus and edits via row tap", () => {
    expect(categoriesScreenSource).toMatch(/accessibilityLabel="New category"/);
    expect(categoriesScreenSource).toMatch(/name="plus"/);
    expect(categoriesScreenSource).toMatch(/categoryEditPath/);
    expect(categoriesScreenSource).not.toMatch(/label="Create category"/);
  });

  it("supports archived filtering without cluttering the default list", () => {
    expect(categoriesScreenSource).toMatch(/Show archived/);
    expect(categoriesScreenSource).toMatch(/showArchived/);
    expect(categoriesScreenSource).toMatch(/include_archived:\s*true/);
  });

  it("loads a lightweight category list only (no forecast/timeline)", () => {
    expect(categoriesScreenSource).toMatch(/listCategories/);
    expect(categoriesScreenSource).not.toMatch(/forecast|timeline|getScenarioComparison|ledger/i);
    expect(categoriesScreenSource).not.toMatch(/invalidateFinancialQueries/);
  });
});

describe("Category form rules", () => {
  it("create form includes name + type; edit locks type and allows archive via switch + delete", () => {
    expect(categoryFormSource).toMatch(/label="Name"/);
    expect(categoryFormSource).toMatch(/TypeSelector/);
    expect(categoryFormSource).toMatch(/disabled=\{isEdit\}/);
    expect(categoryFormSource).toMatch(/cannot be changed/);
    expect(categoryFormSource).toMatch(/createCategory/);
    expect(categoryFormSource).toMatch(/updateCategory/);
    expect(categoryFormSource).toMatch(/deleteCategory/);
    expect(categoryFormSource).toMatch(/accessibilityLabel="Archived"/);
    expect(categoryFormSource).toMatch(/is_archived/);
    expect(categoryFormSource).toMatch(
      /If it has transactions or budgets, it will be archived instead/
    );
  });

  it("does not invent notes or transfer type fields", () => {
    expect(categoryFormSource).not.toMatch(/label="Notes"/);
    expect(categoryFormSource).not.toMatch(/TRANSFER/);
  });

  it("explains archive keeps historical transaction links", () => {
    expect(categoryFormSource).toMatch(/historical transactions/);
  });

  it("uses navigation helpers for create/edit paths", () => {
    expect(categoryCreatePath()).toBe("/categories/new");
    expect(categoryEditPath(9)).toBe("/categories/edit/9");
  });
});

describe("Category query keys and invalidation", () => {
  it("uses canonical managed + detail keys", () => {
    expect(categoriesQueryKeys.managed(7)).toEqual(["categories", "managed", 7]);
    expect(categoriesQueryKeys.detail(3)).toEqual(["categories", "detail", 3]);
  });

  it("invalidates category options and management caches without financial forecasts", () => {
    expect(queryKeysSource).toMatch(/invalidateCategoryOptionsQueries/);
    expect(queryKeysSource).not.toMatch(/invalidateFinancialQueries/);
    expect(financialRefreshSource).not.toMatch(/invalidateCategoryOptionsQueries/);

    const queryClient = new QueryClient();
    const spy = vi.spyOn(queryClient, "invalidateQueries");
    invalidateAfterCategoryMutation(queryClient);
    const keys = spy.mock.calls.map((c) => (c[0] as { queryKey: unknown }).queryKey);
    expect(keys).toEqual(expect.arrayContaining([["categories"], ["category-options"]]));
    expect(keys.some((k) => Array.isArray(k) && k[0] === "forecast")).toBe(false);
    spy.mockRestore();
  });
});

describe("Shared category picker reuse", () => {
  it("Transactions, Recurring, Spending Limits, What-If, and Automation use useCategoryOptions", () => {
    expect(transactionFormSource).toMatch(/useCategoryOptions/);
    expect(recurringFormSource).toMatch(/useCategoryOptions/);
    expect(spendingLimitFormSource).toMatch(/useCategoryOptions/);
    expect(whatIfDataSource).toMatch(/useCategoryOptions/);
    expect(whatIfDataSource).not.toMatch(/what-if-categories/);
    expect(automationFormSource).toMatch(/useCategoryOptions/);
    expect(automationFormSource).not.toMatch(/categories", "automation-form/);
  });

  it("create/edit mutations invalidate the shared picker cache so new categories appear without restart", () => {
    expect(categoryFormSource).toMatch(/invalidateAfterCategoryMutation/);
    expect(queryKeysSource).toMatch(/invalidateCategoryOptionsQueries/);
  });
});
