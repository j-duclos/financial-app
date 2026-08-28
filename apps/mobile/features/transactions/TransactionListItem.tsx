import React, { memo } from "react";
import { Pressable, Text, View } from "react-native";
import FontAwesome from "@expo/vector-icons/FontAwesome";
import { SectionHeader, SkeletonBlock } from "@/components/ui";
import { useTheme } from "@/theme";
import { TransactionRowCard } from "./TransactionRowCard";
import type { TransactionListRow } from "./buildTransactionList";

type Props = {
  item: TransactionListRow;
  onPressTransaction: (id: number) => void;
  onPressRecentRange?: () => void;
  onPressUpcomingRange?: () => void;
  focusHighlight?: boolean;
};

export const TransactionListItem = memo(function TransactionListItem({
  item,
  onPressTransaction,
  onPressRecentRange,
  onPressUpcomingRange,
  focusHighlight,
}: Props) {
  const theme = useTheme();

  const wrapFocusHighlight = (node: React.ReactNode) =>
    focusHighlight ? (
      <View style={{ backgroundColor: theme.colors.warningBg }}>{node}</View>
    ) : (
      node
    );

  if (item.kind === "section") {
    const onRangePress =
      item.rangeKind === "recent"
        ? onPressRecentRange
        : item.rangeKind === "upcoming"
          ? onPressUpcomingRange
          : undefined;
    return (
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          paddingRight: theme.spacing.lg,
        }}
      >
        <View style={{ flex: 1 }}>
          <SectionHeader title={item.title} />
        </View>
        {item.rangeLabel && onRangePress ? (
          <Pressable
            onPress={onRangePress}
            accessibilityRole="button"
            accessibilityLabel={`${item.title} range: ${item.rangeLabel}. Tap to change.`}
            style={{ flexDirection: "row", alignItems: "center", gap: 4, paddingVertical: 8 }}
          >
            <Text style={{ color: theme.colors.tint, ...theme.typography.caption }}>{item.rangeLabel}</Text>
            <FontAwesome name="chevron-down" size={10} color={theme.colors.tint} />
          </Pressable>
        ) : item.rangeLabel ? (
          <Text style={{ color: theme.colors.textMuted, ...theme.typography.caption }}>{item.rangeLabel}</Text>
        ) : null}
      </View>
    );
  }
  if (item.kind === "skeleton") {
    return (
      <View style={{ paddingHorizontal: theme.spacing.lg, paddingVertical: theme.spacing.sm }}>
        <SkeletonBlock lines={2} />
      </View>
    );
  }
  if (item.kind === "upcoming") {
    const txnId = item.row.transaction_id;
    return wrapFocusHighlight(
      <Pressable onPress={() => txnId != null && onPressTransaction(txnId)} disabled={txnId == null}>
        <TransactionRowCard
          timelineRow={item.row}
          runningBalance={item.runningBalance}
          statusOverride="Forecast"
        />
      </Pressable>
    );
  }
  if (item.kind === "pending") {
    const txnId = item.row.transaction_id;
    return wrapFocusHighlight(
      <Pressable onPress={() => txnId != null && onPressTransaction(txnId)} disabled={txnId == null}>
        <TransactionRowCard
          timelineRow={item.row}
          runningBalance={item.runningBalance}
          statusOverride="Pending"
        />
      </Pressable>
    );
  }
  return wrapFocusHighlight(
    <Pressable onPress={() => onPressTransaction(item.txn.id)}>
      <TransactionRowCard txn={item.txn} runningBalance={item.runningBalance} />
    </Pressable>
  );
});
