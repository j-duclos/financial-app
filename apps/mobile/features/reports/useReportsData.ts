import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { getMonthlyReports, listHouseholds } from "@budget-app/api-client";
import { currentMonthStr } from "@budget-app/shared";
import { reportsQueryKeys } from "./queryKeys";
import type { ReportFilters } from "./types";

export function useReportsHousehold() {
  const householdsQuery = useQuery({
    queryKey: ["households"],
    queryFn: () => listHouseholds(),
    staleTime: 5 * 60_000,
  });
  const householdId = householdsQuery.data?.[0]?.id ?? null;
  return { householdsQuery, householdId };
}

export function useReportsData(filters: ReportFilters) {
  const monthKey = filters.monthKey || currentMonthStr();
  const { householdId, householdsQuery } = useReportsHousehold();

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

  return {
    householdId,
    householdsQuery,
    reportsQuery,
    data: reportsQuery.data,
    monthKey,
    isLoading: householdsQuery.isLoading || (householdId != null && reportsQuery.isLoading),
    isError: reportsQuery.isError,
    error: reportsQuery.error,
    isFetching: reportsQuery.isFetching,
    isPlaceholderData: reportsQuery.isPlaceholderData,
    refetch: () => reportsQuery.refetch(),
  };
}
