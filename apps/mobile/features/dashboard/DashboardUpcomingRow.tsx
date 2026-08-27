import React, { memo } from "react";
import { Pressable, Text, View } from "react-native";
import {
  formatCurrency,
  formatShortMonthDay,
  upcomingPreviewAmountTone,
  upcomingPreviewBalanceTone,
  type DashboardUpcomingTransaction,
} from "@budget-app/shared";
import { useTheme } from "@/theme";

const DATE_COLUMN_WIDTH = 52;

type Props = {
  txn: DashboardUpcomingTransaction;
  isFirstZeroCross: boolean;
  onPress: () => void;
  showDivider?: boolean;
};

function upcomingRowAccessibilityLabel(
  txn: DashboardUpcomingTransaction,
  amountNum: number | null,
  balanceNum: number | null
): string {
  const dateLabel = formatShortMonthDay(txn.date);
  const description = txn.description?.trim() || "Transaction";
  const amountPart =
    amountNum != null
      ? amountNum >= 0
        ? `positive ${formatCurrency(txn.amount!)}`
        : `negative ${formatCurrency(txn.amount!)}`
      : "amount unavailable";
  const accountPart = txn.account_name ? `${txn.account_name} account` : null;
  const balancePart =
    balanceNum != null
      ? `balance after ${balanceNum < 0 ? "negative " : ""}${formatCurrency(String(Math.abs(balanceNum)))}`
      : null;
  return [dateLabel, description, amountPart, accountPart, balancePart].filter(Boolean).join(", ") + ".";
}

export const DashboardUpcomingRow = memo(function DashboardUpcomingRow({
  txn,
  isFirstZeroCross,
  onPress,
  showDivider,
}: Props) {
  const theme = useTheme();
  const amountNum = txn.amount != null ? parseFloat(txn.amount) : null;
  const balanceNum = txn.balance_after != null ? parseFloat(txn.balance_after) : null;
  const amountTone = amountNum != null ? upcomingPreviewAmountTone(amountNum, txn) : "neutral";
  const balanceTone =
    balanceNum != null ? upcomingPreviewBalanceTone(balanceNum, isFirstZeroCross) : "neutral";
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

  const metaParts: string[] = [];
  if (txn.account_name) metaParts.push(txn.account_name);
  if (txn.balance_after != null && balanceNum != null) {
    metaParts.push(`Balance after ${formatCurrency(txn.balance_after)}`);
  }
  const metaLine = metaParts.join(" · ");

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
        accessibilityLabel={upcomingRowAccessibilityLabel(txn, amountNum, balanceNum)}
        style={({ pressed }) => ({
          opacity: pressed ? 0.88 : 1,
          minHeight: theme.touchTarget,
          paddingVertical: theme.spacing.sm,
          paddingHorizontal: theme.spacing.md,
          justifyContent: "center",
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
            numberOfLines={1}
            ellipsizeMode="tail"
          >
            {metaLine}
          </Text>
        ) : null}
      </Pressable>
    </>
  );
});
