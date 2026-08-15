import { useQuery } from "@tanstack/react-query";
import { listCategories } from "@budget-app/api-client";

const CATEGORIES_STALE_MS = 5 * 60_000;

export function categoriesQueryKey(opts?: {
  householdId?: number | null;
  includeArchived?: boolean;
}) {
  return [
    "categories",
    opts?.householdId ?? "all",
    { include_archived: opts?.includeArchived === true },
  ] as const;
}

/** Household category list — cached across pages; consumers filter type/archived locally as needed. */
export function useCategories(options?: {
  householdId?: number | null;
  includeArchived?: boolean;
  enabled?: boolean;
}) {
  const householdId = options?.householdId;
  const includeArchived = options?.includeArchived === true;
  return useQuery({
    queryKey: categoriesQueryKey({ householdId, includeArchived }),
    queryFn: () =>
      listCategories({
        ...(householdId != null ? { household: householdId } : {}),
        include_archived: includeArchived,
        page_size: 500,
      }),
    staleTime: CATEGORIES_STALE_MS,
    enabled: options?.enabled ?? true,
  });
}
