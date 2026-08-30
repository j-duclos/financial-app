import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  calendarMonthRangeState,
  monthInCalendarRange,
} from "./calendarUtils";

const useCalendarDataSource = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "useCalendarData.ts"),
  "utf8"
);

const calendarScreenSource = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "CalendarScreen.tsx"),
  "utf8"
);

describe("useCalendarData chunk selection", () => {
  it("does not fall back to windows[0] when visible month is out of range", () => {
    expect(useCalendarDataSource).not.toMatch(/windows\[0\]/);
    expect(useCalendarDataSource).toMatch(/visibleMonthInRange/);
    expect(useCalendarDataSource).toMatch(/chunkWindowForMonth/);
    expect(useCalendarDataSource).toMatch(/chunkEnabled/);
  });

  it("does not issue chunk requests when visible month is outside range", () => {
    expect(useCalendarDataSource).toMatch(/chunkEnabled = enabled && visibleMonthInRange/);
    expect(useCalendarDataSource).toMatch(/"none"/);
  });

  it("refetchCalendar awaits visible chunk and summary together", () => {
    expect(useCalendarDataSource).toMatch(/async \(\) =>/);
    expect(useCalendarDataSource).toMatch(/Promise\.all/);
    expect(useCalendarDataSource).toMatch(/summaryQuery\.refetch/);
    expect(useCalendarDataSource).toMatch(/visibleChunkQuery\.refetch/);
  });

  it("tracks summary failure separately from chunk errors", () => {
    expect(useCalendarDataSource).toMatch(/summaryError: summaryQuery\.isError/);
    expect(useCalendarDataSource).not.toMatch(/isError:.*summaryQuery\.isError/);
  });
});

describe("CalendarScreen refresh and account options", () => {
  it("uses explicit pull-to-refresh lifecycle", () => {
    expect(calendarScreenSource).toMatch(/pullRefreshing/);
    expect(calendarScreenSource).toMatch(/refreshing=\{pullRefreshing\}/);
    expect(calendarScreenSource).not.toMatch(/refreshing=\{isFetching/);
  });

  it("lazy-loads account options when filters closed and all accounts selected", () => {
    expect(calendarScreenSource).toMatch(/enabled: filtersOpen \|\| accountId !== ""/);
  });

  it("shows out-of-range month state instead of empty grid data", () => {
    expect(calendarScreenSource).toMatch(/!visibleMonthInRange/);
    expect(calendarScreenSource).toMatch(/Outside forecast window/);
  });

  it("surfaces summary failure in next risk banner", () => {
    expect(calendarScreenSource).toMatch(/summaryError/);
    expect(calendarScreenSource).toMatch(/refetchSummary/);
  });
});

describe("calendar month range helpers", () => {
  const range = { start: "2026-07-01", end: "2026-08-31" };

  it("monthInCalendarRange detects overlap with forecast window", () => {
    expect(monthInCalendarRange(2026, 7, range)).toBe(true); // August
    expect(monthInCalendarRange(2026, 5, range)).toBe(false); // June
    expect(monthInCalendarRange(2026, 8, range)).toBe(false); // September
  });

  it("calendarMonthRangeState distinguishes empty in-range vs out-of-range", () => {
    expect(calendarMonthRangeState(2026, 7, range, 1, "2026-08-01")).toBe("in_range");
    expect(calendarMonthRangeState(2026, 8, range, 1, "2026-08-01")).toBe("after_forecast");
    expect(calendarMonthRangeState(2026, 4, range, 1, "2026-08-01")).toBe("before_history");
  });
});
