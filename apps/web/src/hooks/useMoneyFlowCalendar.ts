import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getTimelineCalendarChunk,
  getTimelineCalendarSummary,
  isPerfLoggingEnabled,
  perfLog,
} from "@budget-app/api-client";
import type {
  TimelineCalendarDay,
  TimelineCalendarSummaryResponse,
} from "@budget-app/shared";
import {
  calendarQueryKeys,
  isStaleCalendarChunkQuery,
  isStaleCalendarSummaryQuery,
  type CalendarQueryFilters,
} from "@budget-app/shared";
import {
  calendarChunkWindows,
  calendarRangeForSelection,
  type CalendarChunkWindow,
} from "../lib/calendarChunks";
import {
  LARGE_RANGE_IDLE_CHUNK_MS,
  loadCountForVisibleMonth,
  nextIdleLoadCount,
  shouldEagerFetchAllChunks,
  shouldIdlePreloadNextChunk,
} from "../lib/calendarProgressiveLoad";
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

function toQueryFilters(filters: CalendarFilterKey): CalendarQueryFilters {
  return {
    forecastScope: filters.horizon,
    lookbackMonths: filters.lookbackMonths,
    accountId: filters.accountId,
    scenarioId: filters.scenarioId,
    householdId: filters.householdId,
  };
}

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
  const queryFilters = useMemo(() => toQueryFilters(filters), [horizon, lookbackMonths, accountId, scenarioId, householdId]);
  const eagerAll = shouldEagerFetchAllChunks(windows.length);

  const [loadCount, setLoadCount] = useState(1);
  useEffect(() => {
    setLoadCount(eagerAll ? Math.max(1, windows.length) : 1);
  }, [horizon, lookbackMonths, accountId, scenarioId, householdId, eagerAll, windows.length]);

  useEffect(() => {
    const validChunks = new Set(windows.map((window) => `${window.start}:${window.end}`));
    void queryClient.cancelQueries({
      predicate: (query) => {
        const key = query.queryKey;
        if (isStaleCalendarSummaryQuery(key, queryFilters)) return true;
        return isStaleCalendarChunkQuery(key, queryFilters, validChunks);
      },
    });
  }, [queryFilters, windows, queryClient]);

  useEffect(() => {
    if (viewMode !== "calendar") {
      void queryClient.cancelQueries({ queryKey: ["calendar-chunk"] });
      void queryClient.cancelQueries({ queryKey: ["calendar-summary"] });
    }
  }, [viewMode, queryClient]);

  const firstChunkReadyRef = useRef(false);

  const chunkQueries = useQueries({
    queries: windows.map((window, index) => ({
      queryKey: calendarQueryKeys.chunk(queryFilters, window.start, window.end),
      queryFn: ({ signal }: { signal?: AbortSignal }) =>
        getTimelineCalendarChunk(chunkParams(filters, window, range), { signal }),
      enabled: viewMode === "calendar" && Boolean(householdId) && index < loadCount,
      staleTime: 60_000,
      refetchOnWindowFocus: false,
    })),
  });

  const firstChunkReady = Boolean(chunkQueries[0]?.isSuccess);
  firstChunkReadyRef.current = firstChunkReady;

  useEffect(() => {
    if (!isPerfLoggingEnabled() || !firstChunkReady) return;
    const firstDays = chunkQueries[0]?.data?.days?.length ?? 0;
    perfLog(
      `[PERF] calendar first-useful horizon=${horizon} first_chunk_days=${firstDays} windows=${windows.length} loadCount=${loadCount}`
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firstChunkReady]);

  const summaryEnabled =
    viewMode === "calendar" &&
    Boolean(householdId);

  const summaryQuery = useQuery({
    queryKey: calendarQueryKeys.summary(queryFilters),
    queryFn: ({ signal }) =>
      getTimelineCalendarSummary(
        {
          start: range.start,
          end: range.end,
          horizon,
          lookback_months: lookbackMonths,
          account_id: accountId || undefined,
          scenario_id: scenarioId || undefined,
          household_id: householdId,
        },
        { signal }
      ),
    enabled: summaryEnabled,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    if (viewMode !== "calendar" || eagerAll || !firstChunkReady) return;
    if (!shouldIdlePreloadNextChunk(loadCount, windows.length)) return;
    if (!summaryQuery.isSuccess && !summaryQuery.isError) return;
    const idle = window.requestIdleCallback;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    let idleId: number | null = null;
    const bump = () => {
      if (!firstChunkReadyRef.current) return;
      setLoadCount((count) => nextIdleLoadCount(count, windows.length));
    };
    if (typeof idle === "function") {
      idleId = idle(bump, { timeout: LARGE_RANGE_IDLE_CHUNK_MS });
    } else {
      timeoutId = setTimeout(bump, LARGE_RANGE_IDLE_CHUNK_MS);
    }
    return () => {
      if (timeoutId) clearTimeout(timeoutId);
      if (idleId != null && typeof window.cancelIdleCallback === "function") {
        window.cancelIdleCallback(idleId);
      }
    };
  }, [
    viewMode,
    eagerAll,
    firstChunkReady,
    loadCount,
    windows.length,
    summaryQuery.isSuccess,
    summaryQuery.isError,
  ]);

  const ensureMonthLoaded = useCallback(
    (year: number, month: number) => {
      setLoadCount((count) => loadCountForVisibleMonth(windows, year, month, count));
    },
    [windows]
  );

  const chunkDays = chunkQueries.map((query) => query.data?.days);

  const upcomingQuery = useQuery({
    queryKey: ["calendar-timeline-upcoming", accountId, scenarioId, householdId],
    queryFn: ({ signal }) =>
      getTimelineCalendarChunk(
        {
          horizon: "14d",
          lookback_months: 0,
          account_id: accountId || undefined,
          scenario_id: scenarioId || undefined,
          household_id: householdId,
        },
        { signal }
      ),
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
    summaryLoading: summaryEnabled && summaryQuery.isFetching && !summary,
    summaryError: summaryQuery.error,
    firstChunkReady,
    loadingInitial,
    loadingRemaining,
    pendingMonthKeys,
    failedChunks,
    remainingCount: Math.max(0, windows.length - loadCount),
    loadMoreMonths: () => setLoadCount(windows.length),
    ensureMonthLoaded,
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
