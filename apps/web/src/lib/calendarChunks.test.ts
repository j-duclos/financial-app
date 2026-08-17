import { describe, expect, it } from "vitest";
import {
  calendarChunkWindows,
  calendarRangeForSelection,
  chunkCoversMonth,
} from "./calendarChunks";

describe("calendarChunks", () => {
  it("keeps 14-day / ~30-day ranges as a single chunk", () => {
    const range = calendarRangeForSelection("14d", 0, "2025-08-16");
    expect(range.start).toBe("2025-08-01");
    expect(range.end).toBe("2025-08-30");
    expect(calendarChunkWindows(range.start, range.end, "2025-08-16")).toEqual([
      { start: "2025-08-01", end: "2025-08-30" },
    ]);
  });

  it("splits a 6-month range into two-month windows starting with current+next month", () => {
    const range = calendarRangeForSelection("6m", 0, "2025-08-16");
    expect(range.start).toBe("2025-08-01");
    expect(range.end).toBe("2026-02-12");
    const windows = calendarChunkWindows(range.start, range.end, "2025-08-16");
    expect(windows[0]).toEqual({ start: "2025-08-01", end: "2025-09-30" });
    expect(windows[1].start).toBe("2025-10-01");
    expect(windows[windows.length - 1].end).toBe("2026-02-12");
    expect(chunkCoversMonth(windows[0], 2025, 7)).toBe(true);
    expect(chunkCoversMonth(windows[0], 2025, 9)).toBe(false);
  });

  it("loads a 90-day range as near-term first, then the remainder", () => {
    const range = calendarRangeForSelection("3m", 0, "2025-08-16");
    const windows = calendarChunkWindows(range.start, range.end, "2025-08-16");
    expect(windows[0]).toEqual({ start: "2025-08-01", end: "2025-09-30" });
    expect(windows.length).toBeGreaterThan(1);
    expect(windows[windows.length - 1].end).toBe(range.end);
  });
});
