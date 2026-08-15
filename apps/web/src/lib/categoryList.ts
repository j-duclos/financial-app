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

export function filterManagedCategories(
  categories: Category[],
  opts: {
    type: CategoryType;
    source: CategorySourceFilter;
    search: string;
    showArchived: boolean;
  }
): Category[] {
  return categories
    .filter((category) => {
      if (category.category_type !== opts.type) return false;
      if (!opts.showArchived && category.is_archived) return false;
      if (opts.source === "custom" && isDefaultCategory(category)) return false;
      if (opts.source === "default" && !isDefaultCategory(category)) return false;
      return matchesCategorySearch(category, opts.search);
    })
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true }));
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
