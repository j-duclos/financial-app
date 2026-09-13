import React, { memo } from "react";
import { Pressable, Text, View } from "react-native";
import FontAwesome from "@expo/vector-icons/FontAwesome";
import { SkeletonBlock } from "@/components/ui";
import { useTheme } from "@/theme";
import { TransactionRowCard } from "./TransactionRowCard";
import type { TransactionListRow } from "./buildTransactionList";

type Props = {
  item: TransactionListRow;
  onPressRow: (item: TransactionListRow) => void;
  onPressRecentRange?: () => void;
  onPressUpcomingRange?: () => void;
  onPressLoadOlder?: () => void;
  focusHighlight?: boolean;
};

export const TransactionListItem = memo(function TransactionListItem({
  item,
  onPressRow,
  onPressRecentRange,
  onPressUpcomingRange,
  onPressLoadOlder,
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
    const tone =
      item.id === "section-pending" ? "pending" : item.id === "section-upcoming" ? "upcoming" : "recent";
    const backgroundColor =
      tone === "pending"
        ? theme.colors.warningBg
        : tone === "upcoming"
          ? theme.colors.tintMuted
          : theme.colors.surfaceMuted;
    const accentColor =
      tone === "pending"
        ? theme.colors.warning
        : tone === "upcoming"
          ? theme.colors.tint
          : theme.colors.textMuted;
    const rangeColor = tone === "recent" ? theme.colors.textSecondary : accentColor;
    return (
      <View
        style={{
          width: "100%",
          flexDirection: "row",
          alignItems: "stretch",
          backgroundColor,
          borderBottomWidth: 1,
          borderBottomColor: theme.colors.border,
        }}
      >
        <View style={{ width: 4, backgroundColor: accentColor }} />
        <View
          style={{
            flex: 1,
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            paddingLeft: theme.spacing.md,
            paddingRight: theme.spacing.lg,
            paddingVertical: theme.spacing.sm,
          }}
        >
          <View style={{ flex: 1 }}>
            <Text style={{ color: theme.colors.text, ...theme.typography.label, letterSpacing: 0.6 }}>
              {item.title.toUpperCase()}
            </Text>
            {tone === "upcoming" ? (
              <Text style={{ color: accentColor, ...theme.typography.caption, marginTop: 2 }}>
                Forecast
              </Text>
            ) : null}
          </View>
          {item.rangeLabel && onRangePress ? (
            <Pressable
              onPress={onRangePress}
              accessibilityRole="button"
              accessibilityLabel={`${item.title} range: ${item.rangeLabel}. Tap to change.`}
              style={{ flexDirection: "row", alignItems: "center", gap: 4, paddingVertical: 8 }}
            >
              <Text style={{ color: rangeColor, ...theme.typography.caption }}>{item.rangeLabel}</Text>
              <FontAwesome name="chevron-down" size={10} color={rangeColor} />
            </Pressable>
          ) : item.rangeLabel ? (
            <Text style={{ color: theme.colors.textMuted, ...theme.typography.caption }}>{item.rangeLabel}</Text>
          ) : null}
        </View>
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
  if (item.kind === "message") {
    return (
      <Text
        style={{
          color: theme.colors.textMuted,
          ...theme.typography.caption,
          paddingHorizontal: theme.spacing.lg,
          paddingVertical: theme.spacing.sm,
        }}
      >
        {item.text}
      </Text>
    );
  }
  if (item.kind === "loadOlder") {
    return (
      <Pressable
        onPress={onPressLoadOlder}
        disabled={item.loading || !onPressLoadOlder}
        accessibilityRole="button"
        accessibilityLabel="Load older transactions"
        style={{
          minHeight: theme.touchTarget,
          marginHorizontal: theme.spacing.lg,
          marginVertical: theme.spacing.sm,
          borderRadius: theme.radius.md,
          borderWidth: 1,
          borderColor: theme.colors.border,
          backgroundColor: theme.colors.surfaceMuted,
          alignItems: "center",
          justifyContent: "center",
          opacity: item.loading ? 0.7 : 1,
        }}
      >
        <Text style={{ color: theme.colors.tint, ...theme.typography.caption }}>
          {item.loading ? "Loading older transactions…" : "Load older transactions"}
        </Text>
      </Pressable>
    );
  }
  if (item.kind === "upcoming") {
    const txnId = item.row.transaction_id;
    return wrapFocusHighlight(
      <Pressable onPress={() => onPressRow(item)} disabled={txnId == null}>
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
      <Pressable onPress={() => onPressRow(item)} disabled={txnId == null}>
        <TransactionRowCard
          timelineRow={item.row}
          runningBalance={item.runningBalance}
          statusOverride="Pending"
        />
      </Pressable>
    );
  }
  return wrapFocusHighlight(
    <Pressable onPress={() => onPressRow(item)}>
      <TransactionRowCard txn={item.txn} runningBalance={item.runningBalance} />
    </Pressable>
  );
});
