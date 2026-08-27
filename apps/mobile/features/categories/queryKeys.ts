import type { QueryClient } from "@tanstack/react-query";
import { invalidateCategoryOptionsQueries } from "@/lib/referenceQueryKeys";

/**
 * Management-list keys. Picker screens use `referenceQueryKeys.categoryOptions`
 * via `useCategoryOptions` — keep those as the shared selection SoT.
 */
export const categoriesQueryKeys = {
  all: ["categories"] as const,
  managed: (householdId: number | null | undefined) =>
    ["categories", "managed", householdId ?? null] as const,
  detail: (id: number) => ["categories", "detail", id] as const,
};

/**
 * After create/edit/archive/delete:
 * - refresh management list + any leftover `["categories", …]` consumers
 * - refresh canonical picker options (`category-options`)
 * - refresh legacy what-if category cache until fully consolidated
 *
 * Does NOT invalidate financial forecast/timeline prefixes — renaming or
 * archiving a category does not change forecast math.
 */
export function invalidateAfterCategoryMutation(queryClient: QueryClient): void {
  void queryClient.invalidateQueries({ queryKey: categoriesQueryKeys.all });
  invalidateCategoryOptionsQueries(queryClient);
  void queryClient.invalidateQueries({ queryKey: ["what-if-categories"] });
}
