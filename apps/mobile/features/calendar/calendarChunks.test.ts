import { describe, expect, it } from "vitest";
import { calendarChunkWindows, chunkCoversMonth } from "./calendarChunks";
import { calendarRangeForSelection } from "./calendarUtils";

describe("calendarChunks", () => {
  it("uses a single chunk for short operational forecast windows", () => {
    const range = calendarRangeForSelection(30, 1, "2026-08-28");
    expect(range.start).toBe("2026-07-01");
    expect(range.end).toBe("2026-09-27");
    expect(calendarChunkWindows(range.start, range.end, "2026-08-28")).toEqual([
      { start: "2026-07-01", end: "2026-09-27" },
    ]);
  });

  it("covers the visible month with the first near-term chunk window", () => {
    const range = calendarRangeForSelection(90, 1, "2026-08-28");
    const windows = calendarChunkWindows(range.start, range.end, "2026-08-28");
    expect(windows[0]?.start).toBe("2026-07-01");
    expect(chunkCoversMonth(windows[0]!, 2026, 7)).toBe(true);
    expect(chunkCoversMonth(windows[0]!, 2026, 8)).toBe(true);
  });
});
