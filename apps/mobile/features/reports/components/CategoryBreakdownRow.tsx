import React from "react";
import { Pressable, Text, View } from "react-native";
import FontAwesome from "@expo/vector-icons/FontAwesome";
import type { CategoryBreakdownItem } from "@budget-app/shared";
import { formatCurrency } from "@budget-app/shared";
import { CurrencyDisplay } from "@/components/ui";
import { useTheme } from "@/theme";
import {
  formatDeltaVsPrevious,
  formatExpenseSharePercent,
  formatSignedAmount,
  parseOptionalAmount,
} from "../reportDisplay";
import { PeriodComparisonBadge } from "./PeriodComparisonBadge";

type Props = {
  row: CategoryBreakdownItem;
  previousMonth?: string;
  onPress?: () => void;
  showShare?: boolean;
};

export const CategoryBreakdownRow = React.memo(function CategoryBreakdownRow({
  row,
  previousMonth,
  onPress,
  showShare = true,
}: Props) {
  const theme = useTheme();
  const total = parseOptionalAmount(row.total);
  const isExpense = total != null && total < 0;
  const share =
    showShare && isExpense ? formatExpenseSharePercent(row.expense_share_percent) : null;
  const showDelta = Boolean(previousMonth && row.show_comparison && row.delta != null);

  const content = (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        paddingVertical: theme.spacing.sm,
        borderBottomWidth: 1,
        borderBottomColor: theme.colors.border,
        gap: theme.spacing.sm,
      }}
    >
      <View style={{ flex: 1 }}>
        <Text style={{ color: theme.colors.text, fontWeight: "600", fontSize: 15 }}>{row.category_name}</Text>
        {showDelta && row.delta != null ? (
          <PeriodComparisonBadge
            text={formatDeltaVsPrevious(row.delta, previousMonth!)}
            delta={row.delta}
            context={isExpense ? "expense" : "income"}
            style={{ marginTop: 2 }}
          />
        ) : null}
      </View>
      <View style={{ alignItems: "flex-end" }}>
        <CurrencyDisplay
          amount={row.total}
          tone={isExpense ? "negative" : "positive"}
          showSign
          style={{ fontSize: 16 }}
        />
        {share ? (
          <Text style={{ color: theme.colors.textMuted, fontSize: 11, marginTop: 2 }}>{share} of spending</Text>
        ) : null}
      </View>
      {onPress ? <FontAwesome name="chevron-right" size={12} color={theme.colors.textMuted} /> : null}
    </View>
  );

  if (!onPress) return content;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${row.category_name}, ${formatSignedAmount(row.total)}${share ? `, ${share} of spending` : ""}`}
      style={({ pressed }) => [{ opacity: pressed ? 0.7 : 1 }]}
    >
      {content}
    </Pressable>
  );
});

export function CategorySpendBarChart({
  rows,
  limit = 6,
  onCategoryPress,
}: {
  rows: CategoryBreakdownItem[];
  limit?: number;
  onCategoryPress?: (categoryId: number, categoryName: string) => void;
}) {
  const theme = useTheme();
  // Relative bar widths vs peak are presentation-only (not expense share %).
  const ranked = React.useMemo(() => {
    return rows
      .map((row) => {
        const total = parseOptionalAmount(row.total);
        if (total == null || total >= 0) return null;
        return { ...row, abs: Math.abs(total) };
      })
      .filter((row): row is CategoryBreakdownItem & { abs: number } => row != null)
      .sort((a, b) => b.abs - a.abs)
      .slice(0, limit);
  }, [rows, limit]);

  if (ranked.length === 0) return null;

  const peak = Math.max(1, ...ranked.map((r) => r.abs));
  const summary = ranked.map((r) => `${r.category_name} ${formatCurrency(r.abs)}`).join(", ");

  return (
    <View accessible={!onCategoryPress} accessibilityLabel={`Top expense categories: ${summary}`}>
      {ranked.map((row) => {
        const pct = Math.max(2, (row.abs / peak) * 100);
        const content = (
          <View style={{ marginBottom: 10 }}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 4 }}>
              <Text
                style={{ color: theme.colors.text, fontSize: 13, flex: 1, marginRight: 8 }}
                numberOfLines={1}
              >
                {row.category_name}
              </Text>
              <Text style={{ color: theme.colors.textSecondary, fontSize: 13, fontWeight: "600" }}>
                {formatCurrency(row.abs)}
              </Text>
            </View>
            <View
              style={{
                height: 8,
                borderRadius: 4,
                backgroundColor: theme.colors.surfaceMuted,
                overflow: "hidden",
              }}
            >
              <View
                style={{
                  width: `${pct}%`,
                  height: "100%",
                  backgroundColor: theme.colors.moneyNegative,
                  opacity: 0.85,
                }}
              />
            </View>
          </View>
        );

        if (onCategoryPress && row.category_id != null) {
          return (
            <Pressable
              key={row.category_id ?? row.category_name}
              onPress={() => onCategoryPress(row.category_id!, row.category_name)}
              accessibilityRole="button"
              accessibilityLabel={`${row.category_name}, ${formatCurrency(row.abs)}`}
              style={({ pressed }) => [{ opacity: pressed ? 0.7 : 1 }]}
            >
              {content}
            </Pressable>
          );
        }

        return <View key={row.category_id ?? row.category_name}>{content}</View>;
      })}
    </View>
  );
}
