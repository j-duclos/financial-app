import { useCallback, useEffect, useMemo } from "react";
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { getTimelineCalendarChunk, getTimelineCalendarSummary } from "@budget-app/api-client";
import type { TimelineCalendarDay } from "@budget-app/shared";
import { todayStr } from "@/lib/dates";
import { calendarQueryKeys } from "./queryKeys";
import {
  calendarRangeForSelection,
  monthBounds,
  shiftMonth,
} from "./calendarUtils";
import type { CalendarFilters, CalendarHorizon, CalendarLookbackMonths } from "./types";

type UseCalendarDataOptions = {
  visibleYear: number;
  visibleMonth: number;
  filters: CalendarFilters;
  prefetchAdjacent?: boolean;
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
    horizon: filters.horizon,
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
  prefetchAdjacent = true,
}: UseCalendarDataOptions) {
  const queryClient = useQueryClient();
  const todayIso = todayStr();
  const range = useMemo(
    () => calendarRangeForSelection(filters.horizon, filters.lookbackMonths, todayIso),
    [filters.horizon, filters.lookbackMonths, todayIso]
  );

  const visibleBounds = useMemo(
    () => monthBounds(visibleYear, visibleMonth),
    [visibleYear, visibleMonth]
  );

  const prevMonth = useMemo(
    () => shiftMonth(visibleYear, visibleMonth, -1),
    [visibleYear, visibleMonth]
  );
  const nextMonth = useMemo(
    () => shiftMonth(visibleYear, visibleMonth, 1),
    [visibleYear, visibleMonth]
  );

  const prevBounds = useMemo(
    () => monthBounds(prevMonth.year, prevMonth.month),
    [prevMonth.year, prevMonth.month]
  );
  const nextBounds = useMemo(
    () => monthBounds(nextMonth.year, nextMonth.month),
    [nextMonth.year, nextMonth.month]
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
          horizon: filters.horizon,
          lookback_months: filters.lookbackMonths,
          account_id: filters.accountId || undefined,
          scenario_id: filters.scenarioId || undefined,
          household_id: filters.householdId,
        },
        { signal }
      ),
    enabled: enabled && visibleChunkQuery.isSuccess,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  const prefetchMonth = useCallback(
    (year: number, month: number) => {
      if (!filters.householdId) return;
      const bounds = monthBounds(year, month);
      const key = calendarQueryKeys.chunk(filters, bounds.start, bounds.end);
      void queryClient.prefetchQuery({
        queryKey: key,
        queryFn: ({ signal }) =>
          getTimelineCalendarChunk(
            chunkParams(filters, range, bounds.start, bounds.end),
            { signal }
          ),
        staleTime: 60_000,
      });
    },
    [filters, queryClient, range]
  );

  useEffect(() => {
    if (!prefetchAdjacent || !enabled || !visibleChunkQuery.isSuccess) return;
    prefetchMonth(prevMonth.year, prevMonth.month);
    prefetchMonth(nextMonth.year, nextMonth.month);
  }, [
    prefetchAdjacent,
    enabled,
    visibleChunkQuery.isSuccess,
    prefetchMonth,
    prevMonth.year,
    prevMonth.month,
    nextMonth.year,
    nextMonth.month,
  ]);

  const adjacentQueries = useQueries({
    queries: [prevBounds, nextBounds].map((bounds) => ({
      queryKey: calendarQueryKeys.chunk(filters, bounds.start, bounds.end),
      queryFn: ({ signal }: { signal?: AbortSignal }) =>
        getTimelineCalendarChunk(
          chunkParams(filters, range, bounds.start, bounds.end),
          { signal }
        ),
      enabled: false,
      staleTime: 60_000,
    })),
  });

  const days = useMemo(() => {
    const byDate = new Map<string, TimelineCalendarDay>();
    const sources = [
      visibleChunkQuery.data?.days,
      adjacentQueries[0]?.data?.days,
      adjacentQueries[1]?.data?.days,
    ];
    for (const loaded of sources) {
      if (!loaded) continue;
      for (const day of loaded) byDate.set(day.date, day);
    }
    return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
  }, [visibleChunkQuery.data?.days, adjacentQueries]);

  const refetchCalendar = useCallback(() => {
    void visibleChunkQuery.refetch();
    void summaryQuery.refetch();
  }, [visibleChunkQuery, summaryQuery]);

  return {
    range,
    days,
    summary: summaryQuery.data?.summary,
    isLoading: enabled && (visibleChunkQuery.isLoading || visibleChunkQuery.isPending),
    isError: visibleChunkQuery.isError || summaryQuery.isError,
    error: visibleChunkQuery.error ?? summaryQuery.error,
    isFetching: visibleChunkQuery.isFetching,
    refetchCalendar,
  };
}

export function buildCalendarFilters(input: {
  horizon: CalendarHorizon;
  lookbackMonths?: CalendarLookbackMonths;
  accountId?: number | "";
  householdId?: number;
}): CalendarFilters {
  return {
    horizon: input.horizon,
    lookbackMonths: input.lookbackMonths ?? 1,
    accountId: input.accountId ?? "",
    scenarioId: "",
    householdId: input.householdId,
  };
}
