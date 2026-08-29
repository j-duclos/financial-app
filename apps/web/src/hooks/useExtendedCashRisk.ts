import { useQuery } from "@tanstack/react-query";
import { getExtendedCashRisk } from "@budget-app/api-client";
import { extendedCashRiskQueryDefaults } from "@budget-app/shared";

/** Shared 6-month cash-risk scan — not keyed on the page Forecast Window. */
export function useExtendedCashRisk(enabled: boolean) {
  return useQuery({
    ...extendedCashRiskQueryDefaults,
    queryFn: getExtendedCashRisk,
    enabled,
  });
}
