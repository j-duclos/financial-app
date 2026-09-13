import type { Category, CategoryType } from "@budget-app/shared";
import { sortCategoriesForPicker } from "@budget-app/shared";
import type { PickerOption } from "@/components/forms";

export const ANY_CATEGORY_ID = "";
export const ANY_CATEGORY_LABEL = "Any category";
export const CHOOSE_CATEGORY_TITLE = "Choose category.";

/** Collapsed field value: selected name, or the no-category condition. */
export function automationCategoryFieldValue(selectedName: string | undefined | null): string {
  return selectedName?.trim() ? selectedName : ANY_CATEGORY_LABEL;
}

/** Same serialization as the previous chip "None" option: empty → null. */
export function serializeAutomationCategoryId(optionId: string): number | null {
  return optionId ? Number(optionId) : null;
}

export function automationCategoryPickerOptions(
  categories: readonly Category[],
  type: CategoryType
): PickerOption[] {
  const sorted = sortCategoriesForPicker(
    categories.filter((category) => category.category_type === type && !category.is_archived),
    type
  ).map((category) => ({
    id: String(category.id),
    title: category.name,
    searchText: category.name,
  }));

  return [
    {
      id: ANY_CATEGORY_ID,
      title: ANY_CATEGORY_LABEL,
      searchText: "Any category none no category",
      pinned: true,
    },
    ...sorted,
  ];
}

/** Local search; pinned "Any category" stays first when it matches. */
export function filterAutomationCategoryOptions(
  options: readonly PickerOption[],
  query: string
): PickerOption[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...options];

  const matches = options.filter((opt) => {
    const hay = (opt.searchText ?? `${opt.title} ${opt.subtitle ?? ""}`).toLowerCase();
    return hay.includes(q);
  });
  const pinned = matches.filter((opt) => opt.pinned);
  const rest = matches.filter((opt) => !opt.pinned);
  return [...pinned, ...rest];
}
