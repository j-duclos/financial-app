import { describe, expect, it } from "vitest";
import { calendarMonthFromIsoDate, parseIsoDateParam } from "@budget-app/shared";

describe("Calendar date deep link", () => {
  it("parses valid ISO date param", () => {
    expect(parseIsoDateParam("2026-08-28")).toBe("2026-08-28");
    expect(calendarMonthFromIsoDate("2026-08-28")).toEqual({ year: 2026, month: 7 });
  });

  it("ignores malformed date params safely", () => {
    expect(parseIsoDateParam("2026-13-40")).toBeNull();
    expect(parseIsoDateParam("not-a-date")).toBeNull();
    expect(parseIsoDateParam(undefined)).toBeNull();
    expect(parseIsoDateParam(["2026-08-28T00:00:00"])).toBe("2026-08-28");
  });
});
