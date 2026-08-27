import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { getMonthlyReports } from "@budget-app/api-client";
import { currentMonthStr } from "@budget-app/shared";
import { useDefaultHouseholdId } from "@/hooks/useDefaultHouseholdId";
import { reportsQueryKeys } from "./queryKeys";
import type { ReportFilters } from "./types";

export function useReportsData(filters: ReportFilters) {
  const monthKey = filters.monthKey || currentMonthStr();
  const { householdId, isReady: householdReady } = useDefaultHouseholdId();

  const reportsQuery = useQuery({
    queryKey: reportsQueryKeys.monthly(monthKey, householdId, filters.historyMonths),
    queryFn: () =>
      getMonthlyReports(monthKey, {
        months: filters.historyMonths,
        household_id: householdId ?? undefined,
      }),
    enabled: householdId != null,
    staleTime: 60_000,
    placeholderData: keepPreviousData,
  });

  const primaryLoading = householdId != null && reportsQuery.isLoading && !reportsQuery.data;

  return {
    householdId,
    householdReady,
    reportsQuery,
    data: reportsQuery.data,
    monthKey,
    isLoading: !householdReady || primaryLoading,
    isError: reportsQuery.isError,
    error: reportsQuery.error,
    isFetching: reportsQuery.isFetching,
    isPlaceholderData: reportsQuery.isPlaceholderData,
    refetch: () => reportsQuery.refetch(),
  };
}
