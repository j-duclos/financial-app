import { useCallback, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { getTimelineCalendarChunk, getTimelineCalendarSummary } from "@budget-app/api-client";
import type { TimelineCalendarDay } from "@budget-app/shared";
import { todayStr } from "@/lib/dates";
import { calendarQueryKeys, type CalendarQueryFilters } from "./queryKeys";
import {
  calendarMonthRangeState,
  calendarRangeForSelection,
  monthInCalendarRange,
} from "./calendarUtils";
import {
  calendarChunkWindows,
  chunkWindowForMonth,
} from "./calendarChunks";
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

  const visibleMonthInRange = useMemo(
    () => monthInCalendarRange(visibleYear, visibleMonth, range),
    [visibleYear, visibleMonth, range]
  );

  const visibleMonthRangeState = useMemo(
    () =>
      calendarMonthRangeState(
        visibleYear,
        visibleMonth,
        range,
        filters.lookbackMonths,
        todayIso
      ),
    [visibleYear, visibleMonth, range, filters.lookbackMonths, todayIso]
  );

  const chunkWindow = useMemo(() => {
    if (!visibleMonthInRange) return null;
    const windows = calendarChunkWindows(range.start, range.end, todayIso);
    return chunkWindowForMonth(windows, visibleYear, visibleMonth) ?? null;
  }, [range.start, range.end, todayIso, visibleYear, visibleMonth, visibleMonthInRange]);

  const enabled = Boolean(filters.householdId);
  const chunkEnabled = enabled && visibleMonthInRange && chunkWindow != null;

  const queryFilters = useMemo(
    (): CalendarQueryFilters => ({
      forecastScope: filters.forecastDays,
      lookbackMonths: filters.lookbackMonths,
      accountId: filters.accountId,
      scenarioId: filters.scenarioId,
      householdId: filters.householdId,
    }),
    [filters]
  );

  const visibleChunkQuery = useQuery({
    queryKey: calendarQueryKeys.chunk(
      queryFilters,
      chunkWindow?.start ?? "none",
      chunkWindow?.end ?? "none"
    ),
    queryFn: ({ signal }) =>
      getTimelineCalendarChunk(
        chunkParams(filters, range, chunkWindow!.start, chunkWindow!.end),
        { signal }
      ),
    enabled: chunkEnabled,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  const summaryQuery = useQuery({
    queryKey: calendarQueryKeys.summary(queryFilters),
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
    if (!visibleMonthInRange || !chunkWindow) return [];
    const loaded = visibleChunkQuery.data?.days;
    if (!loaded) return [];
    return [...loaded].sort((a, b) => a.date.localeCompare(b.date));
  }, [visibleChunkQuery.data?.days, visibleMonthInRange, chunkWindow]);

  const refetchCalendar = useCallback(async () => {
    const tasks: Promise<unknown>[] = [summaryQuery.refetch()];
    if (chunkEnabled) {
      tasks.push(visibleChunkQuery.refetch());
    }
    await Promise.all(tasks);
  }, [chunkEnabled, summaryQuery, visibleChunkQuery]);

  return {
    range,
    visibleMonthInRange,
    visibleMonthRangeState,
    days,
    summary: summaryQuery.data?.summary,
    isLoading:
      visibleMonthInRange &&
      chunkEnabled &&
      days.length === 0 &&
      (visibleChunkQuery.isLoading || visibleChunkQuery.isPending),
    isSummaryLoading: enabled && summaryQuery.isLoading && !summaryQuery.data,
    isError: visibleMonthInRange && chunkEnabled && visibleChunkQuery.isError,
    summaryError: summaryQuery.isError,
    summaryErrorMessage: summaryQuery.error,
    error: visibleChunkQuery.error ?? summaryQuery.error,
    isFetching: visibleChunkQuery.isFetching,
    refetchCalendar,
    refetchSummary: () => summaryQuery.refetch(),
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
