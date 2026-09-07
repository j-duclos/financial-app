import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { getMonthlyReports } from "@budget-app/api-client";
import {
  canUseReportsAdvanced,
  currentMonthStr,
  effectiveReportHistoryMonths,
} from "@budget-app/shared";
import { useBillingStatus } from "@/hooks/useBillingStatus";
import { useDefaultHouseholdId } from "@/hooks/useDefaultHouseholdId";
import { reportsQueryKeys } from "./queryKeys";
import type { ReportFilters } from "./types";

/**
 * Shared monthly reports query for landing + every report detail route.
 * One backend payload (`GET /api/insights/reports/monthly/`) — no client-side
 * transaction summation. Month + historyMonths are part of the query key so
 * Aug ↔ Jul navigation reuses cached periods via keepPreviousData.
 * Free clients request only Basic history; Premium may request 6/12/24.
 */
export function useReportsData(filters: ReportFilters) {
  const monthKey = filters.monthKey || currentMonthStr();
  const { householdId, isReady: householdReady } = useDefaultHouseholdId();
  const { billing, isLoading: billingLoading } = useBillingStatus();
  const reportsAdvanced = canUseReportsAdvanced(billing);
  const historyMonths = effectiveReportHistoryMonths(filters.historyMonths, billing);
  const billingReady = !billingLoading;

  const reportsQuery = useQuery({
    queryKey: reportsQueryKeys.monthly(monthKey, householdId, historyMonths),
    queryFn: () =>
      getMonthlyReports(monthKey, {
        months: historyMonths,
        household_id: householdId ?? undefined,
      }),
    enabled: householdId != null && billingReady,
    staleTime: 60_000,
    placeholderData: keepPreviousData,
  });

  const primaryLoading =
    householdId != null && billingReady && reportsQuery.isLoading && !reportsQuery.data;

  return {
    householdId,
    householdReady,
    reportsAdvanced,
    reportsQuery,
    data: reportsQuery.data,
    monthKey,
    historyMonths,
    isLoading: !householdReady || !billingReady || primaryLoading,
    isError: reportsQuery.isError,
    error: reportsQuery.error,
    isFetching: reportsQuery.isFetching,
    isPlaceholderData: reportsQuery.isPlaceholderData,
    refetch: () => reportsQuery.refetch(),
  };
}
