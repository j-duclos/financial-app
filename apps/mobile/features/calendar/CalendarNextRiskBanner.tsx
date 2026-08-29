import React from "react";
import { Pressable, Text, View } from "react-native";
import FontAwesome from "@expo/vector-icons/FontAwesome";
import type { TimelineCalendarSummary } from "@budget-app/shared";
import { useTheme } from "@/theme";
import { nextCashShortfallBanner, noCashShortfallsCopy } from "./calendarPresentation";
import { transactionsForForecastRiskPath } from "@/features/payment-planner/navigation";
import type { TimelineCalendarDay } from "@budget-app/shared";

type Props = {
  summary: TimelineCalendarSummary | undefined;
  dayOnRiskDate?: TimelineCalendarDay;
  forecastDays: number;
  onNavigate: (path: ReturnType<typeof transactionsForForecastRiskPath>) => void;
};

export function CalendarNextRiskBanner({ summary, dayOnRiskDate, forecastDays, onNavigate }: Props) {
  const theme = useTheme();
  const banner = summary ? nextCashShortfallBanner(summary, dayOnRiskDate) : null;

  if (banner) {
    const fg = banner.tone === "critical" ? theme.colors.critical : theme.colors.warning;
    const bg = banner.tone === "critical" ? theme.colors.criticalBg : theme.colors.warningBg;

    return (
      <Pressable
        onPress={() =>
          onNavigate(
            transactionsForForecastRiskPath({
              accountId: banner.accountId,
              accountName: banner.accountName,
              focusDate: banner.riskDate,
              focusTransactionId: banner.focusTransactionId,
            })
          )
        }
        style={{
          paddingVertical: 10,
          paddingHorizontal: 12,
          marginBottom: 8,
          borderRadius: theme.radius.md,
          backgroundColor: bg,
          flexDirection: "row",
          alignItems: "center",
          gap: 10,
        }}
        accessibilityRole="button"
        accessibilityLabel={banner.accessibilityLabel}
      >
        <FontAwesome name="exclamation-triangle" size={16} color={fg} />
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={{ color: fg, fontWeight: "700", fontSize: 13 }}>{banner.title}</Text>
          <Text style={{ color: theme.colors.text, fontSize: 13 }}>{banner.subtitle}</Text>
        </View>
        <FontAwesome name="chevron-right" size={12} color={theme.colors.textMuted} />
      </Pressable>
    );
  }

  if (summary && !summary.next_risk_date) {
    return (
      <View
        style={{
          paddingVertical: 8,
          paddingHorizontal: 10,
          marginBottom: 8,
          borderRadius: theme.radius.md,
          backgroundColor: theme.colors.surfaceMuted,
        }}
        accessibilityRole="text"
      >
        <Text style={{ color: theme.colors.textMuted, fontSize: 13, textAlign: "center" }}>
          {noCashShortfallsCopy(forecastDays)}
        </Text>
      </View>
    );
  }

  return null;
}
