import { type ViewStyle } from "react-native";
import { CALENDAR_DAY_CELL_HEIGHT, CALENDAR_WEEKDAY_COLUMNS } from "./calendarUtils";

export const CALENDAR_WEEK_ROW_GAP = 4;

/** Width of one day column from the measured grid inner width (seven equal columns + gaps). */
export function calendarDayCellWidth(gridInnerWidth: number): number {
  if (gridInnerWidth <= 0) return 0;
  const totalGap = CALENDAR_WEEK_ROW_GAP * (CALENDAR_WEEKDAY_COLUMNS - 1);
  return (gridInnerWidth - totalGap) / CALENDAR_WEEKDAY_COLUMNS;
}

/** Fixed-size cell — width from grid measurement, height never varies by week row. */
export function calendarDayCellSizeStyle(cellWidth: number): ViewStyle {
  return {
    width: cellWidth,
    height: CALENDAR_DAY_CELL_HEIGHT,
    minHeight: CALENDAR_DAY_CELL_HEIGHT,
    maxHeight: CALENDAR_DAY_CELL_HEIGHT,
    flexShrink: 0,
    flexGrow: 0,
  };
}

export function calendarWeekRowSizeStyle(): ViewStyle {
  return {
    flexDirection: "row",
    gap: CALENDAR_WEEK_ROW_GAP,
    height: CALENDAR_DAY_CELL_HEIGHT,
    minHeight: CALENDAR_DAY_CELL_HEIGHT,
    maxHeight: CALENDAR_DAY_CELL_HEIGHT,
    flexShrink: 0,
    flexGrow: 0,
    alignItems: "flex-start",
  };
}

export function calendarWeekdayHeaderCellStyle(cellWidth: number): ViewStyle {
  return {
    width: cellWidth,
    alignItems: "center",
    flexShrink: 0,
    flexGrow: 0,
  };
}

export function calendarMonthGridHeight(weekCount: number, rowGap = CALENDAR_WEEK_ROW_GAP): number {
  if (weekCount <= 0) return 0;
  return weekCount * CALENDAR_DAY_CELL_HEIGHT + (weekCount - 1) * rowGap;
}

export { CALENDAR_DAY_CELL_HEIGHT, CALENDAR_WEEKDAY_COLUMNS };
