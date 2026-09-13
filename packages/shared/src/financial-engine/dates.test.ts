import { describe, expect, it } from "vitest";
import {
  addCalendarDays,
  compareIsoDates,
  isIsoDateAfter,
  isIsoDateOnOrBefore,
  isIsoDateString,
  parseIsoDate,
} from "./dates";

describe("financial-engine dates", () => {
  it("parses and rejects invalid calendar days without using local timezone", () => {
    expect(parseIsoDate("2026-01-20")).toEqual({ year: 2026, month: 1, day: 20 });
    expect(isIsoDateString("2026-02-30")).toBe(false);
    expect(() => parseIsoDate("2026-02-30")).toThrow(/Invalid calendar date/);
  });

  it("compares ISO dates lexicographically", () => {
    expect(compareIsoDates("2026-01-20", "2026-01-21")).toBeLessThan(0);
    expect(isIsoDateOnOrBefore("2026-01-20", "2026-01-20")).toBe(true);
    expect(isIsoDateAfter("2026-01-21", "2026-01-20")).toBe(true);
  });

  it("adds calendar days across month/year/leap boundaries", () => {
    expect(addCalendarDays("2026-01-31", 1)).toBe("2026-02-01");
    expect(addCalendarDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addCalendarDays("2024-02-28", 1)).toBe("2024-02-29");
    expect(addCalendarDays("2025-02-28", 1)).toBe("2025-03-01");
    expect(addCalendarDays("2026-01-20", 0)).toBe("2026-01-20");
    expect(addCalendarDays("2026-01-20", -1)).toBe("2026-01-19");
  });
});
