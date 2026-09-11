import type { Category, CategoryType } from "@budget-app/shared";
import {
  sortCategoriesForPicker,
  sortNamedItemsForCategoryPicker,
} from "@budget-app/shared";
import type { PickerOption } from "@/components/forms";

export { sortCategoriesForPicker, sortNamedItemsForCategoryPicker };

export function categoriesOfPickerType(
  categories: readonly Category[],
  type: CategoryType
): Category[] {
  return categories.filter((category) => category.category_type === type);
}

export function categoryPickerOptions(
  categories: readonly Category[],
  type: CategoryType,
  none?: PickerOption | false
): PickerOption[] {
  const options = sortCategoriesForPicker(categoriesOfPickerType(categories, type), type).map(
    (category) => ({
      id: String(category.id),
      title: category.name,
      searchText: category.name,
    })
  );
  if (none === false) return options;
  return [
    ...options,
    none ?? { id: "", title: "None", searchText: "None No category" },
  ];
}
