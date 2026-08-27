import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  CALENDAR_DAY_CELL_HEIGHT,
  CALENDAR_WEEKDAY_COLUMNS,
  CALENDAR_WEEK_ROW_GAP,
  calendarDayCellSizeStyle,
  calendarDayCellWidth,
  calendarMonthGridHeight,
  calendarWeekRowSizeStyle,
} from "./calendarLayout";
import {
  buildMonthGrid,
  calendarGridWeekCount,
  calendarGridWeekRow,
} from "./calendarUtils";

const calendarDayCellSource = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "CalendarDayCell.tsx"),
  "utf8"
);

const calendarMonthGridSource = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "CalendarMonthGrid.tsx"),
  "utf8"
);

describe("calendar month grid layout", () => {
  it("August 2026 pads the final week to seven weekday columns", () => {
    const grid = buildMonthGrid(2026, 7);
    expect(grid.length).toBe(42);
    expect(calendarGridWeekCount(grid)).toBe(6);
    expect(calendarGridWeekRow(grid, 5)).toEqual([
      "2026-08-30",
      "2026-08-31",
      null,
      null,
      null,
      null,
      null,
    ]);
  });

  it("April 2026 uses five week rows without stretching", () => {
    const grid = buildMonthGrid(2026, 3);
    expect(calendarGridWeekCount(grid)).toBe(5);
    expect(calendarMonthGridHeight(5)).toBe(5 * CALENDAR_DAY_CELL_HEIGHT + 4 * CALENDAR_WEEK_ROW_GAP);
  });

  it("August 2026 uses six week rows at fixed row height", () => {
    const grid = buildMonthGrid(2026, 7);
    expect(calendarGridWeekCount(grid)).toBe(6);
    expect(calendarMonthGridHeight(6)).toBe(6 * CALENDAR_DAY_CELL_HEIGHT + 5 * CALENDAR_WEEK_ROW_GAP);
  });

  it("every week row has exactly seven slots", () => {
    const grid = buildMonthGrid(2026, 7);
    for (let row = 0; row < calendarGridWeekCount(grid); row++) {
      expect(calendarGridWeekRow(grid, row)).toHaveLength(CALENDAR_WEEKDAY_COLUMNS);
    }
  });

  it("day cells use explicit width and fixed height, not flex growth or aspect ratio", () => {
    const cellWidth = calendarDayCellWidth(350);
    expect(cellWidth).toBeGreaterThan(0);
    const style = calendarDayCellSizeStyle(cellWidth);
    expect(style.width).toBe(cellWidth);
    expect(style.height).toBe(CALENDAR_DAY_CELL_HEIGHT);
    expect(style.maxHeight).toBe(CALENDAR_DAY_CELL_HEIGHT);
    expect(style.flexGrow).toBe(0);
    expect(style.flexShrink).toBe(0);
    expect(style).not.toHaveProperty("flex");
    expect(style).not.toHaveProperty("aspectRatio");
    expect(calendarWeekRowSizeStyle().flexGrow).toBe(0);
    expect(calendarWeekRowSizeStyle().height).toBe(CALENDAR_DAY_CELL_HEIGHT);
    expect(calendarDayCellSource).not.toMatch(/aspectRatio/);
    expect(calendarDayCellSource).not.toMatch(/flexGrow:\s*1/);
    expect(calendarMonthGridSource).not.toMatch(/aspectRatio/);
    expect(calendarMonthGridSource).toMatch(/calendarDayCellWidth/);
  });

  it("selected-day summary follows the month grid in one screen scroll", () => {
    expect(calendarMonthGridSource).toMatch(/onLayout/);
    expect(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "CalendarScreen.tsx"), "utf8")).toMatch(
      /<ScrollView/
    );
    expect(
      readFileSync(join(dirname(fileURLToPath(import.meta.url)), "CalendarScreen.tsx"), "utf8")
    ).toMatch(/CalendarDaySummary/);
  });

  it("CalendarDaySummary does not link to All transactions", () => {
    const summarySource = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "CalendarDaySummary.tsx"),
      "utf8"
    );
    expect(summarySource).not.toMatch(/All transactions/);
    expect(summarySource).not.toMatch(/onViewAllTransactions/);
  });
});
