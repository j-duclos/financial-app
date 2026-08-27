import React, { useState } from "react";
import { Text, View, useWindowDimensions, type LayoutChangeEvent } from "react-native";
import type { TimelineCalendarDay } from "@budget-app/shared";
import { useTheme } from "@/theme";
import { CalendarDayCell } from "./CalendarDayCell";
import {
  CALENDAR_DAY_CELL_HEIGHT,
  CALENDAR_WEEK_ROW_GAP,
  calendarDayCellWidth,
  calendarMonthGridHeight,
  calendarWeekRowSizeStyle,
  calendarWeekdayHeaderCellStyle,
} from "./calendarLayout";
import {
  buildMonthGrid,
  calendarGridWeekCount,
  calendarGridWeekRow,
  dayMap,
  monthLabel,
} from "./calendarUtils";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

type Props = {
  year: number;
  month: number;
  days: TimelineCalendarDay[];
  selectedDate: string | null;
  onSelectDate: (dateIso: string) => void;
};

export const CalendarMonthGrid = React.memo(function CalendarMonthGrid({
  year,
  month,
  days,
  selectedDate,
  onSelectDate,
}: Props) {
  const theme = useTheme();
  const { width: windowWidth } = useWindowDimensions();
  const grid = buildMonthGrid(year, month);
  const byDate = dayMap(days);
  const weekCount = calendarGridWeekCount(grid);
  const [gridWidth, setGridWidth] = useState(() => Math.max(0, windowWidth - theme.spacing.lg * 2));
  const cellWidth = calendarDayCellWidth(gridWidth);

  const onGridLayout = (event: LayoutChangeEvent) => {
    const width = event.nativeEvent.layout.width;
    if (width > 0 && width !== gridWidth) setGridWidth(width);
  };

  return (
    <View accessibilityRole="adjustable" accessibilityLabel={`Calendar for ${monthLabel(year, month)}`}>
      <Text
        style={{
          color: theme.colors.text,
          ...theme.typography.headline,
          marginBottom: theme.spacing.xs,
        }}
      >
        {monthLabel(year, month)}
      </Text>
      <View onLayout={onGridLayout}>
        <View style={{ flexDirection: "row", marginBottom: 2, gap: CALENDAR_WEEK_ROW_GAP }}>
          {WEEKDAYS.map((label) => (
            <View key={label} style={calendarWeekdayHeaderCellStyle(cellWidth)}>
              <Text style={{ color: theme.colors.textMuted, fontSize: 11, fontWeight: "600" }}>{label}</Text>
            </View>
          ))}
        </View>
        <View style={{ gap: CALENDAR_WEEK_ROW_GAP }}>
          {Array.from({ length: weekCount }, (_, rowIndex) => (
            <View key={rowIndex} style={calendarWeekRowSizeStyle()}>
              {calendarGridWeekRow(grid, rowIndex).map((dateIso, colIndex) =>
                dateIso ? (
                  <CalendarDayCell
                    key={dateIso}
                    dateIso={dateIso}
                    day={byDate.get(dateIso)}
                    selected={selectedDate === dateIso}
                    cellWidth={cellWidth}
                    onPress={onSelectDate}
                  />
                ) : (
                  <View
                    key={`pad-${rowIndex}-${colIndex}`}
                    style={{
                      width: cellWidth,
                      height: CALENDAR_DAY_CELL_HEIGHT,
                      flexShrink: 0,
                    }}
                  />
                )
              )}
            </View>
          ))}
        </View>
      </View>
    </View>
  );
});
