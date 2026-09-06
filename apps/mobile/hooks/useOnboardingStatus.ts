import { useQuery } from "@tanstack/react-query";
import { getOnboardingStatus } from "@budget-app/api-client";
import { useAuth } from "@/features/auth";
import { ONBOARDING_STATUS_QUERY_KEY } from "@/lib/billing";

export function useOnboardingStatus() {
  const { auth } = useAuth();
  const query = useQuery({
    queryKey: ONBOARDING_STATUS_QUERY_KEY,
    queryFn: getOnboardingStatus,
    staleTime: 15_000,
    enabled: auth.isAuthenticated,
    retry: false,
  });

  return {
    status: query.data,
    isLoading: query.isLoading,
    isError: query.isError,
    refetch: query.refetch,
  };
}
