import { describe, expect, it } from "vitest";
import {
  buildMonthGrid,
  calendarGridWeekCount,
  calendarGridWeekRow,
  calendarRangeForSelection,
  dayHasActivity,
  daySeverity,
  isDateWithinForecast,
  monthBounds,
  parseCalendarAmount,
  selectedDateAfterMonthChange,
} from "@/features/calendar/calendarUtils";
import { calendarQueryKeys } from "@/features/calendar/queryKeys";

describe("calendarUtils", () => {
  it("buildMonthGrid pads leading and trailing week boundaries", () => {
    const grid = buildMonthGrid(2026, 7); // August 2026
    expect(grid.slice(0, 6).every((cell) => cell == null)).toBe(true);
    expect(grid.filter(Boolean).length).toBe(31);
    expect(calendarGridWeekCount(grid)).toBe(6);
    expect(calendarGridWeekRow(grid, 5)[0]).toBe("2026-08-30");
    expect(calendarGridWeekRow(grid, 5)[1]).toBe("2026-08-31");
  });

  it("monthBounds returns full month range", () => {
    expect(monthBounds(2026, 1)).toEqual({ start: "2026-02-01", end: "2026-02-28" });
  });

  it("calendarRangeForSelection honors operational forecast days", () => {
    const range = calendarRangeForSelection(30, 1, "2026-08-01");
    expect(range.end).toBe("2026-08-31");
    expect(range.start).toBe("2026-07-01");
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

  it("dayHasActivity treats positive expense_total as activity", () => {
    expect(
      dayHasActivity({
        date: "2026-08-28",
        income_total: "2000",
        expense_total: "3100",
        transfer_total: "0",
        net_total: "-1100",
        ending_balance: "1000",
        lowest_balance: "1000",
        risk_level: "none",
        risk_reason: null,
        has_risk: false,
        transactions: [],
      })
    ).toBe(true);
  });

  it("selectedDateAfterMonthChange clears Aug 28 when entering September", () => {
    expect(selectedDateAfterMonthChange("2026-08-28", 2026, 8)).toBeNull();
  });

  it("selectedDateAfterMonthChange always clears on month change", () => {
    expect(selectedDateAfterMonthChange("2026-09-15", 2026, 8)).toBeNull();
  });

  it("daySeverity flags future negative balance as critical", () => {
    expect(
      daySeverity(
        {
          date: "2026-08-29",
          income_total: "0",
          expense_total: "0",
          transfer_total: "0",
          net_total: "-50",
          ending_balance: "-50",
          lowest_balance: "-50",
          presentation_status: "critical",
          risk_level: "none",
          risk_reason: null,
          has_risk: false,
          is_negative: true,
          transactions: [],
        },
        "2026-08-29"
      )
    ).toBe("critical");
  });

  it("daySeverity treats past negative balance as neutral activity styling", () => {
    expect(
      daySeverity(
        {
          date: "2026-08-27",
          income_total: "0",
          expense_total: "219.14",
          transfer_total: "0",
          net_total: "-219.14",
          ending_balance: "-2535.96",
          lowest_balance: "-2535.96",
          risk_level: "critical",
          risk_reason: "Main projected -2535.96",
          has_risk: true,
          is_negative: true,
          transactions: [],
        },
        "2026-08-27"
      )
    ).toBe("healthy");
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
      forecastDays: 30 as const,
      lookbackMonths: 1 as const,
      accountId: 5 as const,
      scenarioId: "" as const,
      householdId: 1,
    };
    expect(calendarQueryKeys.chunk(filters, "2026-08-01", "2026-08-31")).toEqual([
      "calendar-chunk",
      4,
      30,
      1,
      5,
      "",
      1,
      "2026-08-01",
      "2026-08-31",
    ]);
  });
});
