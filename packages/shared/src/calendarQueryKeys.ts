/**
 * Pure Calendar React Query identity — shared across Web and Mobile.
 *
 * `forecastScope` is the response-affecting forecast dimension for each client:
 * - Web: horizon label (`"6m"`, `"14d"`, …)
 * - Mobile: operational forecast days (`30`, `90`, …)
 */

/** Bump when calendar payload or query identity semantics change. */
export const CALENDAR_QUERY_VERSION = 5;

export type CalendarQueryFilters = {
  /** Web horizon or mobile forecast_days — must match the API request identity. */
  forecastScope: string | number;
  lookbackMonths: number;
  accountId: number | "";
  scenarioId: number | "";
  householdId: number | undefined;
};

export const calendarQueryKeys = {
  summary: (filters: CalendarQueryFilters) =>
    [
      "calendar-summary",
      CALENDAR_QUERY_VERSION,
      filters.forecastScope,
      filters.lookbackMonths,
      filters.accountId,
      filters.scenarioId,
      filters.householdId,
    ] as const,

  chunk: (filters: CalendarQueryFilters, chunkStart: string, chunkEnd: string) =>
    [
      "calendar-chunk",
      CALENDAR_QUERY_VERSION,
      filters.forecastScope,
      filters.lookbackMonths,
      filters.accountId,
      filters.scenarioId,
      filters.householdId,
      chunkStart,
      chunkEnd,
    ] as const,
};

const CHUNK_FILTER_PREFIX_LEN = 7;

function chunkFilterPrefix(filters: CalendarQueryFilters): readonly unknown[] {
  return calendarQueryKeys.chunk(filters, "", "").slice(0, CHUNK_FILTER_PREFIX_LEN);
}

/** True when a cached summary query belongs to a different filter set. */
export function isStaleCalendarSummaryQuery(
  queryKey: readonly unknown[],
  filters: CalendarQueryFilters
): boolean {
  if (queryKey[0] !== "calendar-summary") return false;
  const expected = calendarQueryKeys.summary(filters);
  if (queryKey.length < expected.length) return true;
  return expected.some((value, index) => queryKey[index] !== value);
}

/** True when a cached chunk query belongs to another filter set or invalid chunk window. */
export function isStaleCalendarChunkQuery(
  queryKey: readonly unknown[],
  filters: CalendarQueryFilters,
  validChunkBounds: ReadonlySet<string>
): boolean {
  if (queryKey[0] !== "calendar-chunk") return false;
  const prefix = chunkFilterPrefix(filters);
  for (let i = 0; i < prefix.length; i++) {
    if (queryKey[i] !== prefix[i]) return true;
  }
  const start = queryKey[CHUNK_FILTER_PREFIX_LEN];
  const end = queryKey[CHUNK_FILTER_PREFIX_LEN + 1];
  if (typeof start !== "string" || typeof end !== "string") return true;
  return !validChunkBounds.has(`${start}:${end}`);
}
