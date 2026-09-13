import { useQuery, useQueryClient } from "@tanstack/react-query";
import { listHouseholds } from "@budget-app/api-client";
import { useAuth } from "@/features/auth";
import { classifyQueryClientCache, timedStartupQueryFn } from "@/lib/startupQueries";

export const HOUSEHOLDS_QUERY_KEY = ["households"] as const;
export const HOUSEHOLDS_STALE_MS = 5 * 60_000;

/**
 * Canonical household list — shared by What-If, Automation, Recurring, and forms.
 */
export function useHouseholds(options: { enabled?: boolean } = {}) {
  const { auth } = useAuth();
  const queryClient = useQueryClient();
  const enabled = (options.enabled ?? true) && auth.isAuthenticated;

  return useQuery({
    queryKey: HOUSEHOLDS_QUERY_KEY,
    queryFn: () =>
      timedStartupQueryFn(
        "household",
        classifyQueryClientCache(queryClient, HOUSEHOLDS_QUERY_KEY, HOUSEHOLDS_STALE_MS),
        listHouseholds
      ),
    enabled,
    staleTime: HOUSEHOLDS_STALE_MS,
  });
}
