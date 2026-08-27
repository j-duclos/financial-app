import type { Category, CategoryType } from "@budget-app/shared";

export type CategorySourceFilter = "all" | "custom" | "default";

export function isDefaultCategory(category: Pick<Category, "is_system">): boolean {
  return category.is_system === true;
}

export function matchesCategorySearch(category: Pick<Category, "name">, search: string): boolean {
  const needle = search.trim().toLowerCase();
  if (!needle) return true;
  return category.name.toLowerCase().includes(needle);
}

export function categoryTypeLabel(type: CategoryType): string {
  return type === "INCOME" ? "Income" : "Expense";
}

export function categoryRowSubtitle(category: Pick<Category, "category_type" | "is_archived" | "is_system">): string {
  const parts = [categoryTypeLabel(category.category_type)];
  if (isDefaultCategory(category)) parts.push("Default");
  if (category.is_archived) parts.push("Archived");
  return parts.join(" · ");
}

export function sortCategoriesByName(categories: Category[]): Category[] {
  return [...categories].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true })
  );
}

/** Management list: local search + archived filter across both types. */
export function filterCategoriesForManagement(
  categories: Category[],
  opts: { search: string; showArchived: boolean }
): Category[] {
  return sortCategoriesByName(
    categories.filter((category) => {
      if (!opts.showArchived && category.is_archived) return false;
      return matchesCategorySearch(category, opts.search);
    })
  );
}

export function groupCategoriesByType(categories: Category[]): {
  expense: Category[];
  income: Category[];
} {
  const expense: Category[] = [];
  const income: Category[] = [];
  for (const category of categories) {
    if (category.category_type === "INCOME") income.push(category);
    else expense.push(category);
  }
  return { expense, income };
}

export function filterManagedCategories(
  categories: Category[],
  opts: {
    type: CategoryType;
    source: CategorySourceFilter;
    search: string;
    showArchived: boolean;
  }
): Category[] {
  return sortCategoriesByName(
    categories.filter((category) => {
      if (category.category_type !== opts.type) return false;
      if (!opts.showArchived && category.is_archived) return false;
      if (opts.source === "custom" && isDefaultCategory(category)) return false;
      if (opts.source === "default" && !isDefaultCategory(category)) return false;
      return matchesCategorySearch(category, opts.search);
    })
  );
}

export function groupManagedCategories(categories: Category[]): {
  custom: Category[];
  system: Category[];
} {
  const custom: Category[] = [];
  const system: Category[] = [];
  for (const category of categories) {
    if (isDefaultCategory(category)) system.push(category);
    else custom.push(category);
  }
  return { custom, system };
}

export function categoryRowActions(category: Pick<Category, "is_archived">): {
  edit: boolean;
  archive: boolean;
  restore: boolean;
  delete: boolean;
} {
  return {
    edit: true,
    archive: !category.is_archived,
    restore: category.is_archived,
    delete: true,
  };
}

export function validateCategoryName(name: string): string | null {
  const trimmed = name.trim();
  if (trimmed.length < 2) return "Name must be at least 2 characters.";
  return null;
}

/** Active root parents for a type (exclude self when editing). */
export function parentOptionsForType(
  categories: Category[],
  type: CategoryType,
  editingId?: number | null
): Category[] {
  return sortCategoriesByName(
    categories.filter(
      (c) =>
        c.category_type === type &&
        c.parent === null &&
        !c.is_archived &&
        c.id !== editingId
    )
  );
}
