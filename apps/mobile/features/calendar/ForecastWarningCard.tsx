import React from "react";
import { Text, View } from "react-native";
import type { TimelineCalendarDay } from "@budget-app/shared";
import FontAwesome from "@expo/vector-icons/FontAwesome";
import { useTheme } from "@/theme";
import { daySeverity, daySeverityLabel, parseCalendarAmount } from "./calendarUtils";

type Props = {
  day: TimelineCalendarDay;
};

export function ForecastWarningCard({ day }: Props) {
  const theme = useTheme();
  const severity = daySeverity(day);
  if (severity !== "critical" && severity !== "watch") return null;

  const isForecastDay = day.is_forecast !== false;
  const severityTitle =
    severity === "critical"
      ? isForecastDay
        ? "Financial risk"
        : "Historical risk"
      : daySeverityLabel(severity);
  const isCritical = severity === "critical";
  const bg = isCritical ? theme.colors.criticalBg : theme.colors.warningBg;
  const fg = isCritical ? theme.colors.critical : theme.colors.warning;
  const lowest = parseCalendarAmount(day.lowest_balance);
  const lowestLabel = isForecastDay ? "Lowest projected balance" : "Lowest balance";

  return (
    <View
      accessibilityRole="alert"
      style={{
        flexDirection: "row",
        alignItems: "flex-start",
        gap: 8,
        marginTop: 8,
        padding: 12,
        borderRadius: theme.radius.md,
        backgroundColor: bg,
      }}
    >
      <FontAwesome name="exclamation-triangle" size={16} color={fg} />
      <View style={{ flex: 1, gap: 4 }}>
        <Text style={{ color: fg, fontWeight: "700" }}>{severityTitle}</Text>
        {day.risk_reason ? (
          <Text style={{ color: theme.colors.text, fontSize: 13 }}>{day.risk_reason}</Text>
        ) : null}
        {lowest < 0 ? (
          <Text style={{ color: theme.colors.textSecondary, fontSize: 12 }}>
            {lowestLabel}: {day.lowest_balance}
          </Text>
        ) : null}
        {day.biggest_drivers && day.biggest_drivers.length > 0 ? (
          <Text style={{ color: theme.colors.textSecondary, fontSize: 12 }}>
            Top drivers: {day.biggest_drivers.slice(0, 2).map((d) => d.description).join(", ")}
          </Text>
        ) : null}
      </View>
    </View>
  );
}
