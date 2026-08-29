import type { CalendarFilters } from "./types";

/** Bump when calendar payload semantics change so clients drop stale React Query data. */
const CALENDAR_QUERY_VERSION = 4;

export const calendarQueryKeys = {
  summary: (filters: CalendarFilters) =>
    [
      "calendar-summary",
      CALENDAR_QUERY_VERSION,
      filters.forecastDays,
      filters.lookbackMonths,
      filters.accountId,
      filters.scenarioId,
      filters.householdId,
    ] as const,
  chunk: (filters: CalendarFilters, chunkStart: string, chunkEnd: string) =>
    [
      "calendar-chunk",
      CALENDAR_QUERY_VERSION,
      filters.forecastDays,
      filters.lookbackMonths,
      filters.accountId,
      filters.scenarioId,
      filters.householdId,
      chunkStart,
      chunkEnd,
    ] as const,
};
