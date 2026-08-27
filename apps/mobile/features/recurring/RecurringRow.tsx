import React from "react";
import { Pressable, Text, View } from "react-native";
import { CurrencyDisplay, StatusChip } from "@/components/ui";
import { useTheme } from "@/theme";
import {
  lifecycleBadgeLabel,
  type RecurringListRow,
} from "./recurringDisplay";

type Props = {
  row: RecurringListRow;
  onPress: () => void;
};

export function RecurringRow({ row, onPress }: Props) {
  const theme = useTheme();
  const { rule, amountDisplay, isActive, lifecycleStatus } = row;
  const statusLabel = lifecycleBadgeLabel(lifecycleStatus);

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${rule.name}, ${row.metaLine}`}
      style={({ pressed }) => ({
        paddingVertical: theme.spacing.md,
        paddingHorizontal: theme.spacing.lg,
        backgroundColor: pressed ? theme.colors.surfaceMuted : theme.colors.surface,
        borderBottomWidth: 1,
        borderBottomColor: theme.colors.border,
        opacity: isActive ? 1 : 0.65,
      })}
    >
      <View style={{ flexDirection: "row", alignItems: "flex-start", gap: theme.spacing.sm }}>
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <Text style={{ color: theme.colors.text, fontWeight: "600", fontSize: 16 }} numberOfLines={1}>
            {rule.name}
          </Text>
          <Text style={{ color: theme.colors.textSecondary, fontSize: 13 }} numberOfLines={1}>
            {row.accountLine}
          </Text>
          <Text style={{ color: theme.colors.textMuted, fontSize: 12 }} numberOfLines={1}>
            {row.metaLine}
          </Text>
        </View>
        <View style={{ alignItems: "flex-end", gap: 4 }}>
          <CurrencyDisplay
            amount={amountDisplay.signed}
            currency={rule.currency}
            tone={amountDisplay.tone}
            showSign={amountDisplay.showSign}
            style={{ fontSize: 16 }}
          />
          {statusLabel ? <StatusChip label={statusLabel} tone="warning" /> : null}
        </View>
      </View>
    </Pressable>
  );
}
