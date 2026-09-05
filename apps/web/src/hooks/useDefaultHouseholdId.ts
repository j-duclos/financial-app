import { useQuery } from "@tanstack/react-query";
import { listHouseholds } from "@budget-app/api-client";
import { useProfileQuery } from "../lib/profileQuery";

/** Resolves the household used by household-scoped pages (profile default, then first membership). */
export function useDefaultHouseholdId() {
  const profileQuery = useProfileQuery();
  const householdsQuery = useQuery({
    queryKey: ["households"],
    queryFn: listHouseholds,
  });
  const householdId =
    profileQuery.data?.default_household ?? householdsQuery.data?.[0]?.id ?? null;
  return {
    householdId,
    households: householdsQuery.data ?? [],
    isLoading: profileQuery.isLoading || householdsQuery.isLoading,
    isError: profileQuery.isError || householdsQuery.isError,
    refetch: () => {
      void profileQuery.refetch();
      void householdsQuery.refetch();
    },
  };
}
