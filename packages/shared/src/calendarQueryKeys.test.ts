import { describe, expect, it } from "vitest";
import {
  CALENDAR_QUERY_VERSION,
  calendarQueryKeys,
  isStaleCalendarChunkQuery,
  isStaleCalendarSummaryQuery,
} from "./calendarQueryKeys";

const baseFilters = {
  forecastScope: "6m" as const,
  lookbackMonths: 0,
  accountId: "" as const,
  scenarioId: "" as const,
  householdId: 1,
};

describe("calendarQueryKeys", () => {
  it("uses the same dimension order for summary and chunk keys", () => {
    expect(calendarQueryKeys.summary(baseFilters)).toEqual([
      "calendar-summary",
      CALENDAR_QUERY_VERSION,
      "6m",
      0,
      "",
      "",
      1,
    ]);
    expect(calendarQueryKeys.chunk(baseFilters, "2026-08-01", "2026-09-30")).toEqual([
      "calendar-chunk",
      CALENDAR_QUERY_VERSION,
      "6m",
      0,
      "",
      "",
      1,
      "2026-08-01",
      "2026-09-30",
    ]);
  });

  it("produces different chunk keys for the same window when horizon changes", () => {
    const window = { start: "2026-08-01", end: "2026-09-30" };
    const sixMonth = calendarQueryKeys.chunk(baseFilters, window.start, window.end);
    const twelveMonth = calendarQueryKeys.chunk(
      { ...baseFilters, forecastScope: "12m" },
      window.start,
      window.end
    );
    expect(sixMonth).not.toEqual(twelveMonth);
    expect(sixMonth[2]).toBe("6m");
    expect(twelveMonth[2]).toBe("12m");
  });

  it("aligns mobile forecast_days with web horizon at the forecastScope slot", () => {
    const web = calendarQueryKeys.summary({ ...baseFilters, forecastScope: "6m" });
    const mobile = calendarQueryKeys.summary({ ...baseFilters, forecastScope: 90 });
    expect(web[2]).toBe("6m");
    expect(mobile[2]).toBe(90);
    expect(web.slice(0, 2)).toEqual(mobile.slice(0, 2));
  });
});

describe("stale calendar query predicates", () => {
  it("flags summary queries from another horizon", () => {
    const key = calendarQueryKeys.summary({ ...baseFilters, forecastScope: "3m" });
    expect(isStaleCalendarSummaryQuery(key, baseFilters)).toBe(true);
    expect(isStaleCalendarSummaryQuery(calendarQueryKeys.summary(baseFilters), baseFilters)).toBe(
      false
    );
  });

  it("flags chunk queries from another horizon or invalid chunk bounds", () => {
    const valid = new Set(["2026-08-01:2026-09-30"]);
    const key = calendarQueryKeys.chunk({ ...baseFilters, forecastScope: "12m" }, "2026-08-01", "2026-09-30");
    expect(isStaleCalendarChunkQuery(key, baseFilters, valid)).toBe(true);

    const good = calendarQueryKeys.chunk(baseFilters, "2026-08-01", "2026-09-30");
    expect(isStaleCalendarChunkQuery(good, baseFilters, valid)).toBe(false);

    const wrongWindow = calendarQueryKeys.chunk(baseFilters, "2026-10-01", "2026-11-30");
    expect(isStaleCalendarChunkQuery(wrongWindow, baseFilters, valid)).toBe(true);
  });
});
