import { useEffect, useMemo, useState } from "react";
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getTimelineCalendarChunk,
  getTimelineCalendarSummary,
} from "@budget-app/api-client";
import type {
  TimelineCalendarDay,
  TimelineCalendarSummaryResponse,
} from "@budget-app/shared";
import {
  calendarChunkWindows,
  calendarRangeForSelection,
  type CalendarChunkWindow,
} from "../lib/calendarChunks";
import {
  todayIsoDate,
  type TimelineHorizon,
  type TimelineLookbackMonths,
  type TimelineViewMode,
} from "../lib/timelineCalendarUtils";

export type CalendarFilterKey = {
  horizon: TimelineHorizon;
  lookbackMonths: TimelineLookbackMonths;
  accountId: number | "";
  scenarioId: number | "";
  householdId: number | undefined;
};

function chunkParams(filters: CalendarFilterKey, window: CalendarChunkWindow, range: { start: string; end: string }) {
  return {
    start: range.start,
    end: range.end,
    horizon: filters.horizon,
    lookback_months: filters.lookbackMonths,
    account_id: filters.accountId || undefined,
    scenario_id: filters.scenarioId || undefined,
    household_id: filters.householdId,
    chunk_start: window.start,
    chunk_end: window.end,
  };
}

export function useMoneyFlowCalendar({
  viewMode,
  horizon,
  lookbackMonths,
  accountId,
  scenarioId,
  householdId,
}: CalendarFilterKey & { viewMode: TimelineViewMode }) {
  const queryClient = useQueryClient();
  const todayIso = todayIsoDate();
  const range = useMemo(
    () => calendarRangeForSelection(horizon, lookbackMonths, todayIso),
    [horizon, lookbackMonths, todayIso]
  );
  const windows = useMemo(
    () => calendarChunkWindows(range.start, range.end, todayIso),
    [range.start, range.end, todayIso]
  );
  const filters: CalendarFilterKey = {
    horizon,
    lookbackMonths,
    accountId,
    scenarioId,
    householdId,
  };

  const [loadCount, setLoadCount] = useState(1);
  useEffect(() => {
    setLoadCount(1);
  }, [horizon, lookbackMonths, accountId, scenarioId, householdId]);

  useEffect(() => {
    void queryClient.cancelQueries({
      predicate: (query) => {
        const key = query.queryKey;
        if (key[0] !== "calendar-chunk" && key[0] !== "calendar-summary") return false;
        return (
          key[1] !== horizon ||
          key[2] !== lookbackMonths ||
          key[3] !== accountId ||
          key[4] !== scenarioId ||
          key[5] !== householdId
        );
      },
    });
  }, [horizon, lookbackMonths, accountId, scenarioId, householdId, queryClient]);

  useEffect(() => {
    if (viewMode !== "calendar") {
      void queryClient.cancelQueries({ queryKey: ["calendar-chunk"] });
      void queryClient.cancelQueries({ queryKey: ["calendar-summary"] });
    }
  }, [viewMode, queryClient]);

  const summaryQuery = useQuery({
    queryKey: ["calendar-summary", horizon, lookbackMonths, accountId, scenarioId, householdId],
    queryFn: () =>
      getTimelineCalendarSummary({
        start: range.start,
        end: range.end,
        horizon,
        lookback_months: lookbackMonths,
        account_id: accountId || undefined,
        scenario_id: scenarioId || undefined,
        household_id: householdId,
      }),
    enabled: viewMode === "calendar" && Boolean(householdId),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  const chunkQueries = useQueries({
    queries: windows.map((window, index) => ({
      queryKey: [
        "calendar-chunk",
        horizon,
        lookbackMonths,
        accountId,
        scenarioId,
        householdId,
        window.start,
        window.end,
      ],
      queryFn: () => getTimelineCalendarChunk(chunkParams(filters, window, range)),
      enabled: viewMode === "calendar" && Boolean(householdId) && index < loadCount,
      staleTime: 60_000,
      refetchOnWindowFocus: false,
    })),
  });

  const lastEnabledSuccess = chunkQueries[loadCount - 1]?.isSuccess;
  useEffect(() => {
    if (lastEnabledSuccess && loadCount < windows.length) {
      setLoadCount((count) => Math.min(windows.length, count + 1));
    }
  }, [lastEnabledSuccess, loadCount, windows.length]);

  const chunkDays = chunkQueries.map((query) => query.data?.days);

  const upcomingQuery = useQuery({
    queryKey: ["calendar-timeline-upcoming", accountId, scenarioId, householdId],
    queryFn: () =>
      getTimelineCalendarChunk({
        horizon: "14d",
        lookback_months: 0,
        account_id: accountId || undefined,
        scenario_id: scenarioId || undefined,
        household_id: householdId,
      }),
    enabled: viewMode === "timeline" && Boolean(householdId),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  const days = useMemo(() => {
    const byDate = new Map<string, TimelineCalendarDay>();
    for (const loaded of chunkDays) {
      if (!loaded) continue;
      for (const day of loaded) {
        byDate.set(day.date, day);
      }
    }
    return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
  }, [chunkDays]);

  const pendingMonthKeys = useMemo(() => {
    const pending = new Set<string>();
    windows.forEach((window, index) => {
      const query = chunkQueries[index];
      if (query?.isSuccess) return;
      const start = new Date(`${window.start}T12:00:00`);
      const end = new Date(`${window.end}T12:00:00`);
      const cursor = new Date(start.getFullYear(), start.getMonth(), 1);
      while (cursor <= end) {
        pending.add(`${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}`);
        cursor.setMonth(cursor.getMonth() + 1);
      }
    });
    return pending;
  }, [windows, chunkQueries]);

  const failedChunks = windows
    .map((window, index) => ({ window, query: chunkQueries[index], index }))
    .filter((row) => row.query?.isError)
    .map((row) => ({
      start: row.window.start,
      end: row.window.end,
      onRetry: () => {
        void row.query.refetch();
      },
    }));

  const firstChunkReady = Boolean(chunkQueries[0]?.isSuccess);
  const summary = summaryQuery.data as TimelineCalendarSummaryResponse | undefined;
  const loadingInitial =
    viewMode === "calendar" &&
    Boolean(householdId) &&
    !firstChunkReady &&
    (chunkQueries[0]?.isLoading || chunkQueries[0]?.isPending);
  const loadingRemaining =
    viewMode === "calendar" &&
    firstChunkReady &&
    chunkQueries.some((query, index) => index > 0 && (query.isLoading || query.isPending));

  return {
    range,
    windows,
    days,
    summary: summary?.summary,
    summaryLoading: summaryQuery.isLoading && !summary,
    summaryError: summaryQuery.error,
    firstChunkReady,
    loadingInitial,
    loadingRemaining,
    pendingMonthKeys,
    failedChunks,
    remainingCount: Math.max(0, windows.length - loadCount),
    loadMoreMonths: () => setLoadCount(windows.length),
    eagerMonthCount: (() => {
      if (!windows[0]) return 1;
      const start = new Date(`${windows[0].start}T12:00:00`);
      const end = new Date(`${windows[0].end}T12:00:00`);
      return (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth()) + 1;
    })(),
    upcomingDays: upcomingQuery.data?.days ?? [],
    upcomingLoading: upcomingQuery.isLoading,
    upcomingError: upcomingQuery.error,
    calendarError: chunkQueries[0]?.error ?? summaryQuery.error,
    refetchCalendar: () => {
      void summaryQuery.refetch();
      for (const query of chunkQueries) {
        if (query.isFetched || query.isFetching) void query.refetch();
      }
    },
  };
}
