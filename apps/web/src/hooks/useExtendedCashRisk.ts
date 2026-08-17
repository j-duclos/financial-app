import { useQuery } from "@tanstack/react-query";
import { getExtendedCashRisk } from "@budget-app/api-client";

/** Shared 6-month cash-risk scan — not keyed on the page Forecast Window. */
export function useExtendedCashRisk(enabled: boolean) {
  return useQuery({
    queryKey: ["extended-cash-risk"],
    queryFn: getExtendedCashRisk,
    enabled,
    staleTime: 60_000,
  });
}
