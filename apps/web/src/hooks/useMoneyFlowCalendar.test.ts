import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  CALENDAR_QUERY_VERSION,
  calendarQueryKeys,
  isStaleCalendarChunkQuery,
} from "@budget-app/shared";

const source = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "useMoneyFlowCalendar.ts"),
  "utf8"
);

describe("useMoneyFlowCalendar", () => {
  it("uses shared calendar query keys scoped to filters", () => {
    expect(source).toMatch(/calendarQueryKeys\.summary/);
    expect(source).toMatch(/calendarQueryKeys\.chunk/);
    expect(source).toMatch(/isStaleCalendarSummaryQuery/);
    expect(source).toMatch(/isStaleCalendarChunkQuery/);
    expect(source).toMatch(/forecastScope: filters\.horizon/);
  });

  it("does not fetch calendar chunks while Timeline view is active", () => {
    expect(source).toMatch(/viewMode === "calendar"/);
    expect(source).toMatch(/viewMode === "timeline"/);
    expect(source).toMatch(/cancelQueries\(\{ queryKey: \["calendar-chunk"\] \}\)/);
    expect(source).toMatch(/cancelQueries\(\{ queryKey: \["calendar-summary"\] \}\)/);
  });

  it("loads calendar summary in parallel with first chunk", () => {
    expect(source).toMatch(/shouldEagerFetchAllChunks/);
    expect(source).not.toMatch(/eagerAll \|\| firstChunkReady/);
    expect(source).not.toMatch(/lastEnabledSuccess && loadCount < windows.length/);
  });

  it("does not force a second first-chunk refetch after summary succeeds", () => {
    expect(source).not.toMatch(/chunkQueries\[0\]\.refetch\(\)/);
    expect(source).not.toMatch(/First-chunk refetch after full-range summary/);
  });

  it("loads later chunks from idle time or approaching a month, and passes abort signals", () => {
    expect(source).toMatch(/requestIdleCallback/);
    expect(source).toMatch(/shouldIdlePreloadNextChunk/);
    expect(source).toMatch(/ensureMonthLoaded/);
    expect(source).toMatch(/signal/);
  });

  it("includes horizon in chunk query keys so identical windows differ by horizon", () => {
    const filters = {
      forecastScope: "6m" as const,
      lookbackMonths: 0,
      accountId: "" as const,
      scenarioId: "" as const,
      householdId: 1,
    };
    const sixMonth = calendarQueryKeys.chunk(filters, "2026-08-01", "2026-09-30");
    const twelveMonth = calendarQueryKeys.chunk(
      { ...filters, forecastScope: "12m" },
      "2026-08-01",
      "2026-09-30"
    );
    expect(sixMonth).not.toEqual(twelveMonth);
    expect(sixMonth[2]).toBe("6m");
    expect(twelveMonth[2]).toBe("12m");
    expect(sixMonth[0]).toBe("calendar-chunk");
    expect(sixMonth[1]).toBe(CALENDAR_QUERY_VERSION);
  });

  it("cancels stale chunk queries when horizon changes", () => {
    const valid = new Set(["2026-08-01:2026-09-30"]);
    const active = {
      forecastScope: "6m" as const,
      lookbackMonths: 0,
      accountId: "" as const,
      scenarioId: "" as const,
      householdId: 1,
    };
    const stale = calendarQueryKeys.chunk(
      { ...active, forecastScope: "12m" },
      "2026-08-01",
      "2026-09-30"
    );
    expect(isStaleCalendarChunkQuery(stale, active, valid)).toBe(true);
    expect(
      isStaleCalendarChunkQuery(
        calendarQueryKeys.chunk(active, "2026-08-01", "2026-09-30"),
        active,
        valid
      )
    ).toBe(false);
  });
});
