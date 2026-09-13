import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getProfile } from "@budget-app/api-client";
import { useAuth } from "@/features/auth";
import { PROFILE_QUERY_KEY, PROFILE_STALE_MS } from "@/lib/profileQueryKey";
import { classifyQueryClientCache, timedStartupQueryFn } from "@/lib/startupQueries";

export { PROFILE_QUERY_KEY, PROFILE_STALE_MS } from "@/lib/profileQueryKey";

/**
 * Canonical authenticated profile query. All profile consumers should use this
 * hook so `/api/profile/` is fetched once and shared via React Query cache.
 */
export function useProfile() {
  const { auth } = useAuth();
  const queryClient = useQueryClient();

  return useQuery({
    queryKey: PROFILE_QUERY_KEY,
    queryFn: () =>
      timedStartupQueryFn(
        "profile",
        classifyQueryClientCache(queryClient, PROFILE_QUERY_KEY, PROFILE_STALE_MS),
        getProfile
      ),
    enabled: auth.isAuthenticated,
    initialData: auth.profile ?? undefined,
    staleTime: PROFILE_STALE_MS,
  });
}
