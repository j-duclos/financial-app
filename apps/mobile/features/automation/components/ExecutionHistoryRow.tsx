import React from "react";
import { Pressable, Text, View } from "react-native";
import { StatusChip } from "@/components/ui";
import { useTheme } from "@/theme";
import { formatDateDisplay } from "@/lib/dates";
import type { ExecutionHistoryRow } from "../automationDisplay";

type Props = {
  row: ExecutionHistoryRow;
  onPress?: () => void;
};

export function ExecutionHistoryRowView({ row, onPress }: Props) {
  const theme = useTheme();
  const { transaction, statusLabel, statusTone, actionTaken } = row;

  const content = (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        paddingHorizontal: theme.spacing.lg,
        paddingVertical: theme.spacing.sm,
        borderTopWidth: 1,
        borderTopColor: theme.colors.border,
        gap: 12,
      }}
    >
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <Text style={{ color: theme.colors.text, fontWeight: "600" }} numberOfLines={1}>
          {transaction.payee || "Rule occurrence"}
        </Text>
        <Text style={{ color: theme.colors.textSecondary, fontSize: 12 }}>
          {formatDateDisplay(transaction.date)}
        </Text>
        <Text style={{ color: theme.colors.textMuted, fontSize: 11 }} numberOfLines={1}>
          {actionTaken}
        </Text>
      </View>
      <StatusChip label={statusLabel} tone={statusTone} />
    </View>
  );

  if (onPress) {
    return (
      <Pressable onPress={onPress} accessibilityRole="button">
        {content}
      </Pressable>
    );
  }

  return content;
}
