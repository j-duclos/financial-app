import type { CalendarFilters } from "./types";

export const calendarQueryKeys = {
  summary: (filters: CalendarFilters) =>
    [
      "calendar-summary",
      filters.forecastDays,
      filters.lookbackMonths,
      filters.accountId,
      filters.scenarioId,
      filters.householdId,
    ] as const,
  chunk: (filters: CalendarFilters, chunkStart: string, chunkEnd: string) =>
    [
      "calendar-chunk",
      filters.forecastDays,
      filters.lookbackMonths,
      filters.accountId,
      filters.scenarioId,
      filters.householdId,
      chunkStart,
      chunkEnd,
    ] as const,
};
