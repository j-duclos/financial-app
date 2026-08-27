import React from "react";
import { Text, View } from "react-native";
import type { TimelineCalendarDay } from "@budget-app/shared";
import { useTheme } from "@/theme";
import { CalendarDayCell } from "./CalendarDayCell";
import { buildMonthGrid, dayMap, monthLabel } from "./calendarUtils";

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
  const grid = buildMonthGrid(year, month);
  const byDate = dayMap(days);

  return (
    <View accessibilityRole="adjustable" accessibilityLabel={`Calendar for ${monthLabel(year, month)}`}>
      <Text
        style={{
          color: theme.colors.text,
          ...theme.typography.headline,
          marginBottom: theme.spacing.sm,
        }}
      >
        {monthLabel(year, month)}
      </Text>
      <View style={{ flexDirection: "row", marginBottom: 4 }}>
        {WEEKDAYS.map((label) => (
          <View key={label} style={{ flex: 1, alignItems: "center" }}>
            <Text style={{ color: theme.colors.textMuted, fontSize: 11, fontWeight: "600" }}>{label}</Text>
          </View>
        ))}
      </View>
      <View style={{ gap: 4 }}>
        {Array.from({ length: Math.ceil(grid.length / 7) }, (_, rowIndex) => (
          <View key={rowIndex} style={{ flexDirection: "row", gap: 4 }}>
            {grid.slice(rowIndex * 7, rowIndex * 7 + 7).map((dateIso, colIndex) =>
              dateIso ? (
                <CalendarDayCell
                  key={dateIso}
                  dateIso={dateIso}
                  day={byDate.get(dateIso)}
                  selected={selectedDate === dateIso}
                  onPress={onSelectDate}
                />
              ) : (
                <View key={`pad-${rowIndex}-${colIndex}`} style={{ flex: 1, aspectRatio: 1 }} />
              )
            )}
          </View>
        ))}
      </View>
    </View>
  );
});
