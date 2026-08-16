import { useQuery } from "@tanstack/react-query";
import { getProfile } from "@budget-app/api-client";

export const PROFILE_QUERY_KEY = ["profile"] as const;
export const PROFILE_STALE_MS = 5 * 60_000;

/** Shared profile query — reuse this cache instead of fetching per page. */
export function useProfileQuery() {
  return useQuery({
    queryKey: PROFILE_QUERY_KEY,
    queryFn: getProfile,
    staleTime: PROFILE_STALE_MS,
  });
}
