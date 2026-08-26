import React from "react";
import { Pressable, Text, View } from "react-native";
import type { TimelineCalendarDay } from "@budget-app/shared";
import FontAwesome from "@expo/vector-icons/FontAwesome";
import { useTheme } from "@/theme";
import {
  dayAccessibilityLabel,
  dayHasActivity,
  daySeverity,
  daySeverityLabel,
  parseCalendarAmount,
} from "./calendarUtils";
import { todayStr } from "@/lib/dates";

type Props = {
  dateIso: string;
  day?: TimelineCalendarDay;
  selected: boolean;
  onPress: (dateIso: string) => void;
};

function severityColors(
  severity: ReturnType<typeof daySeverity>,
  theme: ReturnType<typeof useTheme>
) {
  switch (severity) {
    case "critical":
      return { bg: theme.colors.criticalBg, border: theme.colors.critical, dot: theme.colors.critical };
    case "watch":
      return { bg: theme.colors.warningBg, border: theme.colors.warning, dot: theme.colors.warning };
    case "healthy":
      return { bg: theme.colors.moneyPositiveBg, border: theme.colors.border, dot: theme.colors.moneyPositive };
    default:
      return { bg: theme.colors.surface, border: theme.colors.border, dot: theme.colors.textMuted };
  }
}

export function CalendarDayCell({ dateIso, day, selected, onPress }: Props) {
  const theme = useTheme();
  const today = todayStr() === dateIso;
  const dayNum = Number(dateIso.slice(8, 10));
  const severity = day ? daySeverity(day) : "neutral";
  const colors = severityColors(severity, theme);
  const active = day ? dayHasActivity(day) : false;
  const income = day ? parseCalendarAmount(day.income_total) : 0;
  const expense = day ? parseCalendarAmount(day.expense_total) : 0;
  const eventCount = day?.transactions.length ?? 0;
  const ariaLabel = day
    ? dayAccessibilityLabel(day, dateIso)
    : `${dateIso}, no forecast data`;

  return (
    <Pressable
      onPress={() => onPress(dateIso)}
      accessibilityRole="button"
      accessibilityLabel={ariaLabel}
      accessibilityHint={day?.is_negative ? "Projected negative balance" : undefined}
      accessibilityState={{ selected }}
      style={({ pressed }) => ({
        flex: 1,
        aspectRatio: 1,
        minHeight: 44,
        padding: 4,
        borderRadius: theme.radius.md,
        borderWidth: today ? 2 : 1,
        borderColor: today ? theme.colors.tint : selected ? theme.colors.tint : colors.border,
        backgroundColor: pressed ? theme.colors.surfaceMuted : colors.bg,
        alignItems: "center",
        justifyContent: "flex-start",
        gap: 2,
      })}
    >
      <Text
        style={{
          color: theme.colors.text,
          fontWeight: today || selected ? "700" : "600",
          fontSize: 13,
        }}
      >
        {dayNum}
      </Text>
      {active ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 3 }}>
          {income > 0 ? (
            <FontAwesome name="arrow-down" size={8} color={theme.colors.moneyPositive} accessibilityLabel="Income" />
          ) : null}
          {expense < 0 ? (
            <FontAwesome name="arrow-up" size={8} color={theme.colors.moneyNegative} accessibilityLabel="Expense" />
          ) : null}
          {eventCount > 0 ? (
            <Text style={{ color: theme.colors.textSecondary, fontSize: 9, fontWeight: "600" }}>
              {eventCount}
            </Text>
          ) : null}
          {(severity === "critical" || severity === "watch") && (
            <FontAwesome
              name="exclamation-circle"
              size={9}
              color={colors.dot}
              accessibilityLabel={daySeverityLabel(severity)}
            />
          )}
        </View>
      ) : (
        <Text style={{ color: theme.colors.textMuted, fontSize: 8 }} accessibilityElementsHidden>
          ·
        </Text>
      )}
    </Pressable>
  );
}
