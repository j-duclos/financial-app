import { useQuery } from "@tanstack/react-query";
import { getExtendedCashRisk } from "@budget-app/api-client";
import { extendedCashRiskQueryDefaults } from "@budget-app/shared";

export function useExtendedCashRisk(enabled: boolean) {
  return useQuery({
    ...extendedCashRiskQueryDefaults,
    queryFn: () => getExtendedCashRisk(),
    enabled,
  });
}
