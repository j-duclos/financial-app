import React from "react";
import { Pressable, Text, View } from "react-native";
import { getEffectiveDisplayName } from "@budget-app/shared";
import { CurrencyDisplay, StatusChip } from "@/components/ui";
import { useTheme } from "@/theme";
import { cadenceLabel, directionLabel, formatRecurringDate, type RecurringListRow } from "./recurringDisplay";

type Props = {
  row: RecurringListRow;
  onPress: () => void;
};

export function RecurringRow({ row, onPress }: Props) {
  const theme = useTheme();
  const { rule, nextOccurrence, isActive } = row;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${rule.name}, ${cadenceLabel(rule)}, next ${formatRecurringDate(nextOccurrence)}`}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        paddingVertical: theme.spacing.md,
        paddingHorizontal: theme.spacing.lg,
        backgroundColor: pressed ? theme.colors.surfaceMuted : theme.colors.surface,
        borderBottomWidth: 1,
        borderBottomColor: theme.colors.border,
        opacity: isActive ? 1 : 0.65,
        gap: theme.spacing.sm,
      })}
    >
      <View
        style={{
          width: 4,
          alignSelf: "stretch",
          borderRadius: 2,
          backgroundColor:
            rule.direction === "INCOME"
              ? theme.colors.moneyPositive
              : rule.direction === "TRANSFER"
                ? theme.colors.neutral
                : theme.colors.moneyNegative,
        }}
        accessibilityElementsHidden
      />
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <Text style={{ color: theme.colors.text, fontWeight: "600" }} numberOfLines={1}>
          {rule.name}
        </Text>
        <Text style={{ color: theme.colors.textSecondary, fontSize: 12 }} numberOfLines={1}>
          {row.cadenceLabel}
          {rule.category?.name ? ` · ${rule.category.name}` : ""}
        </Text>
        <Text style={{ color: theme.colors.textMuted, fontSize: 11 }} numberOfLines={1}>
          {getEffectiveDisplayName(rule.account)}
        </Text>
      </View>
      <View style={{ alignItems: "flex-end", gap: 4 }}>
        <CurrencyDisplay amount={rule.amount} style={{ fontSize: 16 }} />
        <Text style={{ color: theme.colors.textSecondary, fontSize: 11 }}>
          Next {formatRecurringDate(nextOccurrence)}
        </Text>
        <View style={{ flexDirection: "row", gap: 4 }}>
          <StatusChip label={directionLabel(rule.direction)} tone="neutral" />
          {!isActive ? <StatusChip label="Inactive" tone="warning" /> : null}
        </View>
      </View>
    </Pressable>
  );
}
