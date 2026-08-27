import { describe, expect, it } from "vitest";
import {
  buildMonthGrid,
  dayHasActivity,
  daySeverity,
  isDateWithinForecast,
  monthBounds,
  parseCalendarAmount,
} from "@/features/calendar/calendarUtils";
import { horizonForForecastDays } from "@/features/calendar/types";
import { calendarQueryKeys } from "@/features/calendar/queryKeys";

describe("calendarUtils", () => {
  it("buildMonthGrid pads to week boundaries", () => {
    const grid = buildMonthGrid(2026, 7); // August 2026 starts on Saturday
    expect(grid[0]).toBeNull();
    expect(grid.filter(Boolean).length).toBe(31);
  });

  it("monthBounds returns full month range", () => {
    expect(monthBounds(2026, 1)).toEqual({ start: "2026-02-01", end: "2026-02-28" });
  });

  it("dayHasActivity detects income or transactions", () => {
    expect(
      dayHasActivity({
        date: "2026-08-01",
        income_total: "100",
        expense_total: "0",
        transfer_total: "0",
        net_total: "100",
        ending_balance: "100",
        lowest_balance: "100",
        risk_level: "none",
        risk_reason: null,
        has_risk: false,
        transactions: [],
      })
    ).toBe(true);
  });

  it("daySeverity flags negative balance as critical", () => {
    expect(
      daySeverity({
        date: "2026-08-01",
        income_total: "0",
        expense_total: "0",
        transfer_total: "0",
        net_total: "-50",
        ending_balance: "-50",
        lowest_balance: "-50",
        risk_level: "none",
        risk_reason: null,
        has_risk: false,
        is_negative: true,
        transactions: [],
      })
    ).toBe("critical");
  });

  it("isDateWithinForecast respects configured window", () => {
    expect(isDateWithinForecast("2026-08-15", 30, "2026-08-01")).toBe(true);
    expect(isDateWithinForecast("2026-10-01", 30, "2026-08-01")).toBe(false);
  });

  it("parseCalendarAmount handles empty values", () => {
    expect(parseCalendarAmount(null)).toBe(0);
    expect(parseCalendarAmount("12.5")).toBe(12.5);
  });
});

describe("calendar query keys", () => {
  it("keys chunks by month range and filters", () => {
    const filters = {
      horizon: "3m" as const,
      lookbackMonths: 1 as const,
      accountId: 5 as const,
      scenarioId: "" as const,
      householdId: 1,
    };
    expect(calendarQueryKeys.chunk(filters, "2026-08-01", "2026-08-31")).toEqual([
      "calendar-chunk",
      "3m",
      1,
      5,
      "",
      1,
      "2026-08-01",
      "2026-08-31",
    ]);
  });
});

describe("horizonForForecastDays", () => {
  it("maps operational forecast days to calendar horizons", () => {
    expect(horizonForForecastDays(30)).toBe("3m");
    expect(horizonForForecastDays(180)).toBe("6m");
  });
});
