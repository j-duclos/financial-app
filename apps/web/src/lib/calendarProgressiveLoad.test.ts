import { describe, expect, it } from "vitest";
import { calendarChunkWindows, calendarRangeForSelection } from "./calendarChunks";
import {
  countDayCellsForMonths,
  loadCountForVisibleMonth,
  nextIdleLoadCount,
  shouldEagerFetchAllChunks,
} from "./calendarProgressiveLoad";

describe("calendarProgressiveLoad", () => {
  it("keeps short ranges as a single eager fetch", () => {
    expect(shouldEagerFetchAllChunks(1)).toBe(true);
    expect(shouldEagerFetchAllChunks(4)).toBe(false);
  });

  it("does not immediately schedule every remaining 6-month chunk", () => {
    const range = calendarRangeForSelection("6m", 0, "2025-08-16");
    const windows = calendarChunkWindows(range.start, range.end, "2025-08-16");
    expect(windows.length).toBeGreaterThan(2);
    expect(nextIdleLoadCount(1, windows.length)).toBe(2);
    expect(nextIdleLoadCount(2, windows.length)).toBe(3);
    expect(nextIdleLoadCount(windows.length, windows.length)).toBe(windows.length);
  });

  it("scroll toward the next chunk loads it without skipping to February", () => {
    const range = calendarRangeForSelection("6m", 0, "2025-08-16");
    const windows = calendarChunkWindows(range.start, range.end, "2025-08-16");
    expect(loadCountForVisibleMonth(windows, 2025, 9, 1)).toBe(2);
    expect(loadCountForVisibleMonth(windows, 2026, 1, 1)).toBe(1);
  });

  it("initial useful paint mounts about two months of cells, not six", () => {
    expect(countDayCellsForMonths(2)).toBe(84);
    expect(countDayCellsForMonths(2)).toBeLessThan(countDayCellsForMonths(6));
  });
});
