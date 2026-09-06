import { describe, expect, it } from "vitest";
import { formatDateDisplay, formatDateTimeDisplay, formatMonthYear, formatLongDate, formatFullDate } from "./dateDisplay";

describe("formatDateDisplay", () => {
  it("formats ISO date as MM-DD-YY", () => {
    expect(formatDateDisplay("2026-05-23")).toBe("05-23-26");
    expect(formatDateDisplay("2026-06-17")).toBe("06-17-26");
  });

  it("returns em dash for empty values", () => {
    expect(formatDateDisplay(null)).toBe("—");
    expect(formatDateDisplay("")).toBe("—");
  });
});

describe("formatDateTimeDisplay", () => {
  it("uses date portion only", () => {
    expect(formatDateTimeDisplay("2026-05-28T14:30:00Z")).toBe("05-28-26");
  });
});

describe("formatMonthYear", () => {
  it("formats ISO date as Mon YYYY", () => {
    expect(formatMonthYear("2026-12-01")).toBe("Dec 2026");
    expect(formatMonthYear("2029-08-17")).toBe("Aug 2029");
  });

  it("returns null for empty values", () => {
    expect(formatMonthYear(null)).toBeNull();
    expect(formatMonthYear("")).toBeNull();
  });
});

describe("formatLongDate", () => {
  it("formats ISO date as Mon D, YYYY", () => {
    expect(formatLongDate("2026-05-30")).toBe("May 30, 2026");
  });
});

describe("formatFullDate", () => {
  it("formats ISO date as Month D, YYYY", () => {
    expect(formatFullDate("2026-10-05")).toBe("October 5, 2026");
    expect(formatFullDate("2026-10-05T23:00:00Z")).toBe("October 5, 2026");
  });
});
