import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  completeOnboarding,
  dismissOnboarding,
  getOnboardingStatus,
} from "@budget-app/api-client";
import { useAuth } from "../context/AuthContext";

export const ONBOARDING_STATUS_QUERY_KEY = ["onboarding", "status"] as const;

export function useOnboardingStatus() {
  const { auth } = useAuth();
  const query = useQuery({
    queryKey: ONBOARDING_STATUS_QUERY_KEY,
    queryFn: getOnboardingStatus,
    staleTime: 15_000,
    enabled: Boolean(auth.access) && !auth.loading,
    retry: false,
  });
  return {
    status: query.data,
    isLoading: query.isLoading,
    isError: query.isError,
    refetch: query.refetch,
  };
}

export function useOnboardingActions() {
  const queryClient = useQueryClient();
  const completeMu = useMutation({
    mutationFn: completeOnboarding,
    onSuccess: (data) => {
      queryClient.setQueryData(ONBOARDING_STATUS_QUERY_KEY, data);
    },
  });
  const dismissMu = useMutation({
    mutationFn: dismissOnboarding,
    onSuccess: (data) => {
      queryClient.setQueryData(ONBOARDING_STATUS_QUERY_KEY, data);
    },
  });
  return { completeMu, dismissMu };
}
