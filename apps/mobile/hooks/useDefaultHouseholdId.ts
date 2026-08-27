import { useProfile } from "@/lib/profileQuery";

/**
 * Default household from the authenticated profile (`default_household`).
 * Does not fall back to `households[0]` — callers choose that only when appropriate.
 */
export function useDefaultHouseholdId(): {
  householdId: number | null;
  isLoading: boolean;
  isReady: boolean;
} {
  const { data: profile, isLoading, isFetched, isError } = useProfile();

  const isReady = isFetched || isError || profile != null;

  return {
    householdId: profile?.default_household ?? null,
    isLoading: isLoading && !isReady,
    isReady,
  };
}
