import { useCallback, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { getTimelineCalendarChunk, getTimelineCalendarSummary } from "@budget-app/api-client";
import type { TimelineCalendarDay } from "@budget-app/shared";
import { todayStr } from "@/lib/dates";
import { calendarQueryKeys } from "./queryKeys";
import {
  calendarRangeForSelection,
  monthBounds,
} from "./calendarUtils";
import type { CalendarFilters, CalendarLookbackMonths } from "./types";
import type { OperationalForecastDays } from "@budget-app/shared";

type UseCalendarDataOptions = {
  visibleYear: number;
  visibleMonth: number;
  filters: CalendarFilters;
};

function chunkParams(
  filters: CalendarFilters,
  range: { start: string; end: string },
  chunkStart: string,
  chunkEnd: string
) {
  return {
    start: range.start,
    end: range.end,
    forecast_days: filters.forecastDays,
    lookback_months: filters.lookbackMonths,
    account_id: filters.accountId || undefined,
    scenario_id: filters.scenarioId || undefined,
    household_id: filters.householdId,
    chunk_start: chunkStart,
    chunk_end: chunkEnd,
  };
}

export function useCalendarData({
  visibleYear,
  visibleMonth,
  filters,
}: UseCalendarDataOptions) {
  const todayIso = todayStr();
  const range = useMemo(
    () => calendarRangeForSelection(filters.forecastDays, filters.lookbackMonths, todayIso),
    [filters.forecastDays, filters.lookbackMonths, todayIso]
  );

  const visibleBounds = useMemo(
    () => monthBounds(visibleYear, visibleMonth),
    [visibleYear, visibleMonth]
  );

  const enabled = Boolean(filters.householdId);

  const visibleChunkQuery = useQuery({
    queryKey: calendarQueryKeys.chunk(filters, visibleBounds.start, visibleBounds.end),
    queryFn: ({ signal }) =>
      getTimelineCalendarChunk(
        chunkParams(filters, range, visibleBounds.start, visibleBounds.end),
        { signal }
      ),
    enabled,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  const summaryQuery = useQuery({
    queryKey: calendarQueryKeys.summary(filters),
    queryFn: ({ signal }) =>
      getTimelineCalendarSummary(
        {
          start: range.start,
          end: range.end,
          forecast_days: filters.forecastDays,
          lookback_months: filters.lookbackMonths,
          account_id: filters.accountId || undefined,
          scenario_id: filters.scenarioId || undefined,
          household_id: filters.householdId,
        },
        { signal }
      ),
    enabled,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  const days = useMemo((): TimelineCalendarDay[] => {
    const loaded = visibleChunkQuery.data?.days;
    if (!loaded) return [];
    return [...loaded].sort((a, b) => a.date.localeCompare(b.date));
  }, [visibleChunkQuery.data?.days]);

  const refetchCalendar = useCallback(() => {
    void visibleChunkQuery.refetch();
    void summaryQuery.refetch();
  }, [visibleChunkQuery, summaryQuery]);

  return {
    range,
    days,
    summary: summaryQuery.data?.summary,
    isLoading: enabled && days.length === 0 && (visibleChunkQuery.isLoading || visibleChunkQuery.isPending),
    isSummaryLoading: enabled && summaryQuery.isLoading && !summaryQuery.data,
    isError: visibleChunkQuery.isError,
    summaryError: summaryQuery.isError,
    error: visibleChunkQuery.error ?? summaryQuery.error,
    isFetching: visibleChunkQuery.isFetching,
    refetchCalendar,
  };
}

export function buildCalendarFilters(input: {
  forecastDays: OperationalForecastDays;
  lookbackMonths?: CalendarLookbackMonths;
  accountId?: number | "";
  householdId?: number;
}): CalendarFilters {
  return {
    forecastDays: input.forecastDays,
    lookbackMonths: input.lookbackMonths ?? 1,
    accountId: input.accountId ?? "",
    scenarioId: "",
    householdId: input.householdId,
  };
}
