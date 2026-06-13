import type { Category } from "@budget-app/shared";

export type CategoryDropdownOption = Category & { label: string };

function categoryDedupeKey(c: Category): string {
  const parent = c.parent ?? "";
  return `${c.category_type}\0${parent}\0${c.name.trim().toLowerCase()}`;
}

/** Drop duplicate names from API results (same household/type/parent). Keeps oldest id. */
export function dedupeCategories(categories: Category[]): Category[] {
  const byKey = new Map<string, Category>();
  for (const c of categories) {
    const key = categoryDedupeKey(c);
    const existing = byKey.get(key);
    if (!existing || c.id < existing.id) {
      byKey.set(key, c);
    }
  }
  return Array.from(byKey.values());
}

export function categoriesForDropdown(categories: Category[]): CategoryDropdownOption[] {
  return dedupeCategories(categories)
    .sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true })
    )
    .map((c) => ({ ...c, label: c.name }));
}
