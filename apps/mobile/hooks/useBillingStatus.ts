import { useQuery } from "@tanstack/react-query";
import { getBillingStatus } from "@budget-app/api-client";
import { useAuth } from "@/features/auth";
import { BILLING_STATUS_QUERY_KEY } from "@/lib/billing";

export function useBillingStatus(options?: { enabled?: boolean }) {
  const { auth } = useAuth();
  const query = useQuery({
    queryKey: BILLING_STATUS_QUERY_KEY,
    queryFn: getBillingStatus,
    staleTime: 30_000,
    enabled: (options?.enabled ?? true) && auth.isAuthenticated,
  });

  return {
    billing: query.data,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
    isFetching: query.isFetching,
  };
}
