import React from "react";
import { Pressable, Text, View } from "react-native";
import { formatCurrency } from "@budget-app/shared";
import { StatusChip } from "@/components/ui";
import { useTheme } from "@/theme";
import {
  SPENDING_TARGET_STATUS_LABELS,
  spendingTargetProgressPercent,
  spendingTargetStatusTone,
} from "./spendingTargetDisplay";
import type { BudgetCategoryRow } from "./types";

type Props = {
  row: BudgetCategoryRow;
  onPress: () => void;
};

export const BudgetCategoryRow = React.memo(function BudgetCategoryRow({ row, onPress }: Props) {
  const theme = useTheme();
  const { target, metrics } = row;
  const name = target.name || metrics.category_name;
  const pct = spendingTargetProgressPercent(metrics);
  const statusLabel = SPENDING_TARGET_STATUS_LABELS[metrics.status];
  const tone = spendingTargetStatusTone(metrics.status);
  const barColor =
    tone === "critical"
      ? theme.colors.critical
      : tone === "warning"
        ? theme.colors.warning
        : theme.colors.moneyPositive;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${name}, ${statusLabel}, ${Math.round(pct)} percent used, spent ${formatCurrency(metrics.spent_so_far)} of ${formatCurrency(metrics.target_amount)}`}
      style={({ pressed }) => ({
        paddingVertical: theme.spacing.md,
        paddingHorizontal: theme.spacing.lg,
        backgroundColor: pressed ? theme.colors.surfaceMuted : theme.colors.surface,
        borderBottomWidth: 1,
        borderBottomColor: theme.colors.border,
        gap: 8,
      })}
    >
      <View style={{ flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
        <View style={{ flex: 1 }}>
          <Text style={{ color: theme.colors.text, fontWeight: "600", fontSize: 16 }} numberOfLines={1}>
            {name}
          </Text>
          <Text style={{ color: theme.colors.textSecondary, fontSize: 12, marginTop: 2 }}>
            {formatCurrency(metrics.spent_so_far)} spent · {formatCurrency(metrics.remaining_to_target)} left
          </Text>
        </View>
        <StatusChip
          label={statusLabel}
          tone={tone === "critical" ? "critical" : tone === "warning" ? "warning" : tone === "positive" ? "positive" : "neutral"}
        />
      </View>
      <View
        accessibilityRole="progressbar"
        accessibilityValue={{ min: 0, max: 100, now: Math.round(pct), text: `${Math.round(pct)}% used` }}
        style={{ height: 8, borderRadius: 4, backgroundColor: theme.colors.surfaceMuted, overflow: "hidden" }}
      >
        <View style={{ height: "100%", width: `${Math.min(pct, 100)}%`, backgroundColor: barColor }} />
      </View>
      <Text style={{ color: theme.colors.textMuted, fontSize: 11 }}>
        {Math.round(pct)}% of {formatCurrency(metrics.target_amount)} limit
        {parseFloat(metrics.scheduled_in_period ?? "0") > 0
          ? ` · ${formatCurrency(metrics.scheduled_in_period)} upcoming`
          : ""}
      </Text>
    </Pressable>
  );
});
