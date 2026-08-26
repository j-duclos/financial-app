import React from "react";
import { Pressable, Text, View } from "react-native";
import type { TimelineCalendarTransaction } from "@budget-app/shared";
import { formatCurrency, getEffectiveDisplayName } from "@budget-app/shared";
import FontAwesome from "@expo/vector-icons/FontAwesome";
import { useTheme } from "@/theme";
import { StatusChip } from "@/components/ui";
import { parseCalendarAmount } from "./calendarUtils";

type Props = {
  txn: TimelineCalendarTransaction;
  onPress: () => void;
};

function eventStatusLabel(txn: TimelineCalendarTransaction): string | null {
  const status = txn.status?.toUpperCase();
  if (status === "PLANNED" || txn.kind === "projected") return "Forecast";
  if (txn.rule_id && !txn.transaction_id) return "Recurring";
  if (txn.is_transfer) return "Transfer";
  if (status === "CLEARED" || status === "RECONCILED") return "Posted";
  return null;
}

export function CalendarEventRow({ txn, onPress }: Props) {
  const theme = useTheme();
  const amount = parseCalendarAmount(txn.amount);
  const status = eventStatusLabel(txn);
  const tone =
    txn.is_transfer ? "neutral" : amount > 0 ? "positive" : amount < 0 ? "negative" : "neutral";

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${txn.description}, ${formatCurrency(txn.amount ?? "0")}, ${txn.account_name}`}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        paddingVertical: theme.spacing.sm,
        paddingHorizontal: theme.spacing.md,
        backgroundColor: pressed ? theme.colors.surfaceMuted : theme.colors.surface,
        borderBottomWidth: 1,
        borderBottomColor: theme.colors.border,
        gap: theme.spacing.sm,
      })}
    >
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <Text style={{ color: theme.colors.text, fontWeight: "600" }} numberOfLines={1}>
          {txn.description}
        </Text>
        <Text style={{ color: theme.colors.textSecondary, fontSize: 12 }} numberOfLines={1}>
          {txn.account_name}
          {txn.category ? ` · ${txn.category}` : ""}
        </Text>
        {txn.is_transfer && txn.transfer_to_account_name ? (
          <Text style={{ color: theme.colors.textMuted, fontSize: 11 }} numberOfLines={1}>
            → {txn.transfer_to_account_name}
          </Text>
        ) : null}
      </View>
      <View style={{ alignItems: "flex-end", gap: 4 }}>
        <Text
          style={{
            color:
              tone === "positive"
                ? theme.colors.moneyPositive
                : tone === "negative"
                  ? theme.colors.moneyNegative
                  : theme.colors.text,
            fontWeight: "700",
          }}
        >
          {formatCurrency(txn.amount ?? "0")}
        </Text>
        {status ? (
          <StatusChip
            label={status}
            tone={status === "Forecast" || status === "Recurring" ? "neutral" : "neutral"}
          />
        ) : null}
        {txn.risk_flag ? (
          <FontAwesome name="exclamation-triangle" size={12} color={theme.colors.critical} accessibilityLabel="Risk" />
        ) : null}
      </View>
    </Pressable>
  );
}
