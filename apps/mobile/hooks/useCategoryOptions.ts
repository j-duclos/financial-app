import { useQuery } from "@tanstack/react-query";
import { listCategories } from "@budget-app/api-client";
import {
  CATEGORY_OPTIONS_STALE_MS,
  referenceQueryKeys,
} from "@/lib/referenceQueryKeys";

type UseCategoryOptionsOptions = {
  householdId?: number | null;
  type?: "INCOME" | "EXPENSE";
  enabled?: boolean;
};

/**
 * Lightweight categories for pickers/filters — shared across Transactions, forms, etc.
 * page_size=500 matches backend reference-list cap; typical households stay well under this limit.
 */
export function useCategoryOptions(options: UseCategoryOptionsOptions = {}) {
  const householdId = options.householdId ?? null;
  const enabled = (options.enabled ?? true) && householdId != null;

  const query = useQuery({
    queryKey: [...referenceQueryKeys.categoryOptions(householdId), options.type ?? null] as const,
    queryFn: () =>
      listCategories({
        household: householdId ?? undefined,
        type: options.type,
        page_size: 500,
      }),
    enabled,
    staleTime: CATEGORY_OPTIONS_STALE_MS,
  });

  return {
    ...query,
    categories: query.data?.results ?? [],
    householdId,
  };
}
