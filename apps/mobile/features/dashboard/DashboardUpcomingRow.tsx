import React, { memo } from "react";
import { Pressable, Text, View } from "react-native";
import FontAwesome from "@expo/vector-icons/FontAwesome";
import {
  formatCurrency,
  formatShortMonthDay,
  upcomingPreviewAmountTone,
  upcomingPreviewRowBalanceTone,
  upcomingPreviewRowMetaLine,
  type DashboardUpcomingTransaction,
} from "@budget-app/shared";
import { useTheme } from "@/theme";

const DATE_COLUMN_WIDTH = 52;

type Props = {
  txn: DashboardUpcomingTransaction;
  isFirstZeroCross: boolean;
  onPress: () => void;
  showDivider?: boolean;
  shortfallAccountName?: string | null;
};

function upcomingRowAccessibilityLabel(
  txn: DashboardUpcomingTransaction,
  amountNum: number | null,
  metaLine: string | null
): string {
  const dateLabel = formatShortMonthDay(txn.date);
  const description = txn.description?.trim() || "Transaction";
  const amountPart =
    amountNum != null
      ? amountNum >= 0
        ? `positive ${formatCurrency(txn.amount!)}`
        : `negative ${formatCurrency(txn.amount!)}`
      : "amount unavailable";
  return [dateLabel, description, amountPart, metaLine].filter(Boolean).join(", ") + ".";
}

export const DashboardUpcomingRow = memo(function DashboardUpcomingRow({
  txn,
  isFirstZeroCross,
  onPress,
  showDivider,
  shortfallAccountName,
}: Props) {
  const theme = useTheme();
  const amountNum = txn.amount != null ? parseFloat(txn.amount) : null;
  const amountTone = amountNum != null ? upcomingPreviewAmountTone(amountNum, txn) : "neutral";
  const balanceTone = upcomingPreviewRowBalanceTone(txn, isFirstZeroCross, shortfallAccountName);
  const amountColor =
    amountTone === "positive"
      ? theme.colors.moneyPositive
      : amountTone === "negative"
        ? theme.colors.moneyNegative
        : theme.colors.text;
  const balanceColor =
    balanceTone === "critical"
      ? theme.colors.critical
      : balanceTone === "negative"
        ? theme.colors.moneyNegative
        : theme.colors.textMuted;

  const metaLine = upcomingPreviewRowMetaLine(txn, {
    shortfallAccountName,
    isFirstZeroCross,
  });

  return (
    <>
      {showDivider ? (
        <View
          style={{
            height: 1,
            backgroundColor: theme.colors.border,
            marginLeft: DATE_COLUMN_WIDTH + theme.spacing.sm,
          }}
        />
      ) : null}
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={upcomingRowAccessibilityLabel(txn, amountNum, metaLine)}
        style={({ pressed }) => ({
          opacity: pressed ? 0.88 : 1,
          minHeight: theme.touchTarget,
          paddingVertical: theme.spacing.sm,
          paddingHorizontal: theme.spacing.md,
          justifyContent: "center",
          ...(isFirstZeroCross ? { backgroundColor: theme.colors.warningBg } : null),
        })}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: theme.spacing.sm }}>
          <Text
            style={{
              color: theme.colors.textMuted,
              ...theme.typography.caption,
              width: DATE_COLUMN_WIDTH,
            }}
          >
            {formatShortMonthDay(txn.date)}
          </Text>
          <Text
            style={{ color: theme.colors.text, ...theme.typography.bodyStrong, flex: 1, flexShrink: 1 }}
            numberOfLines={1}
            ellipsizeMode="tail"
          >
            {txn.description}
          </Text>
          {txn.amount != null && amountNum != null ? (
            <Text
              style={{
                color: amountColor,
                fontWeight: "700",
                fontSize: 15,
                marginLeft: 4,
                flexShrink: 0,
              }}
            >
              {amountNum > 0 ? "+" : ""}
              {formatCurrency(txn.amount)}
            </Text>
          ) : (
            <Text style={{ color: theme.colors.textMuted, flexShrink: 0 }}>—</Text>
          )}
        </View>
        {metaLine ? (
          <Text
            style={{
              color: balanceColor,
              ...theme.typography.caption,
              marginTop: 2,
              marginLeft: DATE_COLUMN_WIDTH + theme.spacing.sm,
            }}
            numberOfLines={2}
            ellipsizeMode="tail"
          >
            {metaLine}
          </Text>
        ) : null}
      </Pressable>
    </>
  );
});
