import React from "react";
import { Pressable, Text, View } from "react-native";
import type { TimelineCalendarDay } from "@budget-app/shared";
import FontAwesome from "@expo/vector-icons/FontAwesome";
import { useTheme } from "@/theme";
import { calendarDayCellSizeStyle } from "./calendarLayout";
import {
  calendarDayAccessibilityLabel,
  calendarDateState,
  calendarDayPresentationStatus,
  calendarGridShowsRiskIndicator,
  calendarGridTone,
  resolveCalendarDayCellChrome,
  type CalendarDayCellChrome,
  type CalendarGridTone,
} from "./calendarPresentation";
import { dayHasActivity, parseCalendarAmount } from "./calendarUtils";
import { todayStr } from "@/lib/dates";

type Props = {
  dateIso: string;
  day?: TimelineCalendarDay;
  selected: boolean;
  cellWidth: number;
  onPress: (dateIso: string) => void;
};

function riskDotColor(tone: CalendarGridTone, theme: ReturnType<typeof useTheme>): string {
  if (tone === "critical") return theme.colors.critical;
  if (tone === "warning") return theme.colors.warning;
  return theme.colors.textMuted;
}

function chromeColors(
  chrome: CalendarDayCellChrome,
  theme: ReturnType<typeof useTheme>
): { bg: string; border: string } {
  const bgByKind: Record<CalendarDayCellChrome["background"], string> = {
    neutral: theme.colors.surface,
    today: theme.colors.tintMuted,
    warning: theme.colors.warningBg,
    critical: theme.colors.criticalBg,
  };
  const borderByKind: Record<CalendarDayCellChrome["border"], string> = {
    neutral: theme.colors.border,
    today: theme.colors.tint,
    selected: theme.colors.tint,
    warning: theme.colors.warning,
    critical: theme.colors.critical,
  };
  return {
    bg: bgByKind[chrome.background],
    border: borderByKind[chrome.border],
  };
}

export const CalendarDayCell = React.memo(function CalendarDayCell({
  dateIso,
  day,
  selected,
  cellWidth,
  onPress,
}: Props) {
  const theme = useTheme();
  const todayIso = todayStr();
  const dayNum = Number(dateIso.slice(8, 10));
  const presentationStatus = day
    ? calendarDayPresentationStatus(day, dateIso, todayIso)
    : calendarDateState(dateIso, todayIso) === "past"
      ? "historical"
      : "future_healthy";
  const riskTone = calendarGridTone(presentationStatus);
  const chrome = resolveCalendarDayCellChrome({
    dateIso,
    isSelected: selected,
    riskTone,
    todayIso,
  });
  const colors = chromeColors(chrome, theme);
  const active = day ? dayHasActivity(day) : false;
  const income = day ? parseCalendarAmount(day.income_total) : 0;
  const expense = day ? parseCalendarAmount(day.expense_total) : 0;
  const transfer = day ? parseCalendarAmount(day.transfer_total) : 0;
  const eventCount = day?.transactions.length ?? 0;
  const showRiskIndicator = calendarGridShowsRiskIndicator(presentationStatus);
  const ariaLabel = day
    ? calendarDayAccessibilityLabel(day, dateIso, todayIso)
    : `${dateIso}, no calendar data`;

  return (
    <Pressable
      onPress={() => onPress(dateIso)}
      accessibilityRole="button"
      accessibilityLabel={ariaLabel}
      accessibilityHint={showRiskIndicator ? "Future cash risk on this day" : undefined}
      accessibilityState={{ selected }}
      style={({ pressed }) => ({
        ...calendarDayCellSizeStyle(cellWidth),
        padding: 4,
        borderRadius: theme.radius.md,
        borderWidth: chrome.borderWidth,
        borderColor: colors.border,
        backgroundColor: pressed ? theme.colors.surfaceMuted : colors.bg,
        alignItems: "center",
        justifyContent: "flex-start",
        overflow: "hidden",
      })}
    >
      <Text
        style={{
          color: theme.colors.text,
          fontWeight: chrome.dayNumberWeight,
          fontSize: 13,
        }}
      >
        {dayNum}
      </Text>
      {active ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 2, flexShrink: 1 }}>
          {income > 0 ? (
            <FontAwesome name="arrow-down" size={8} color={theme.colors.moneyPositive} accessibilityLabel="Income" />
          ) : null}
          {expense < 0 ? (
            <FontAwesome name="arrow-up" size={8} color={theme.colors.moneyNegative} accessibilityLabel="Expense" />
          ) : null}
          {transfer !== 0 ? (
            <FontAwesome name="exchange" size={7} color={theme.colors.textMuted} accessibilityLabel="Transfer" />
          ) : null}
          {eventCount > 0 ? (
            <Text style={{ color: theme.colors.textSecondary, fontSize: 9, fontWeight: "600" }}>
              {eventCount}
            </Text>
          ) : null}
          {showRiskIndicator ? (
            <FontAwesome
              name="exclamation-circle"
              size={9}
              color={riskDotColor(riskTone, theme)}
              accessibilityLabel="Forecast risk"
            />
          ) : null}
        </View>
      ) : (
        <Text style={{ color: theme.colors.textMuted, fontSize: 8 }} accessibilityElementsHidden>
          ·
        </Text>
      )}
    </Pressable>
  );
});
