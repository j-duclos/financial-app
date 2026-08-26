import { useQuery } from "@tanstack/react-query";
import { getExtendedCashRisk } from "@budget-app/api-client";

export function useExtendedCashRisk(enabled: boolean) {
  return useQuery({
    queryKey: ["extended-cash-risk"],
    queryFn: () => getExtendedCashRisk(),
    enabled,
    staleTime: 60_000,
  });
}
