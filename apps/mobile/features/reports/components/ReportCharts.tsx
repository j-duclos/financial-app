import React, { useMemo } from "react";
import { ScrollView, Text, View } from "react-native";
import type { MonthlySummary } from "@budget-app/shared";
import { formatCurrency } from "@budget-app/shared";
import { useTheme } from "@/theme";
import { formatShortMonth, parseAmount } from "../reportDisplay";

type TrendPoint = Pick<MonthlySummary, "month" | "total_income" | "total_expenses">;

export function IncomeExpenseTrendChart({ trend }: { trend: TrendPoint[] }) {
  const theme = useTheme();
  const points = useMemo(
    () =>
      trend.map((row) => ({
        month: row.month,
        income: parseAmount(row.total_income),
        expense: Math.abs(parseAmount(row.total_expenses)),
      })),
    [trend]
  );

  if (points.length === 0) return null;

  const peak = Math.max(1, ...points.flatMap((p) => [p.income, p.expense]));
  const summary =
    points.length > 1
      ? `Income versus expenses from ${formatShortMonth(points[0].month)} to ${formatShortMonth(points[points.length - 1].month)}`
      : `Income versus expenses for ${formatShortMonth(points[0].month)}`;

  return (
    <View accessible accessibilityLabel={summary}>
      <Text style={{ color: theme.colors.textSecondary, fontSize: 12, marginBottom: 8 }}>{summary}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 12, paddingBottom: 4 }}>
        {points.map((p) => {
          const incomeH = Math.max(4, (p.income / peak) * 80);
          const expenseH = Math.max(4, (p.expense / peak) * 80);
          return (
            <View key={p.month} style={{ alignItems: "center", width: 44 }}>
              <View style={{ flexDirection: "row", alignItems: "flex-end", height: 84, gap: 3 }}>
                <View
                  accessibilityLabel={`${formatShortMonth(p.month)} income ${formatCurrency(p.income)}`}
                  style={{
                    width: 14,
                    height: incomeH,
                    backgroundColor: theme.colors.moneyPositive,
                    borderRadius: 2,
                  }}
                />
                <View
                  accessibilityLabel={`${formatShortMonth(p.month)} expenses ${formatCurrency(p.expense)}`}
                  style={{
                    width: 14,
                    height: expenseH,
                    backgroundColor: theme.colors.moneyNegative,
                    borderRadius: 2,
                    opacity: 0.85,
                  }}
                />
              </View>
              <Text style={{ color: theme.colors.textMuted, fontSize: 10, marginTop: 4 }}>
                {formatShortMonth(p.month)}
              </Text>
            </View>
          );
        })}
      </ScrollView>
      <View style={{ flexDirection: "row", gap: 16, marginTop: 8 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <View style={{ width: 10, height: 10, borderRadius: 2, backgroundColor: theme.colors.moneyPositive }} />
          <Text style={{ color: theme.colors.textMuted, fontSize: 11 }}>Income</Text>
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <View
            style={{ width: 10, height: 10, borderRadius: 2, backgroundColor: theme.colors.moneyNegative, opacity: 0.85 }}
          />
          <Text style={{ color: theme.colors.textMuted, fontSize: 11 }}>Expenses</Text>
        </View>
      </View>
    </View>
  );
}

export function InterestTrendChart({
  trend,
}: {
  trend: Array<{ month: string; interest_paid: string }>;
}) {
  const theme = useTheme();
  const points = useMemo(
    () =>
      trend
        .filter((row) => parseAmount(row.interest_paid) > 0)
        .map((row) => ({
          month: row.month,
          amount: parseAmount(row.interest_paid),
        })),
    [trend]
  );

  if (points.length < 2) return null;

  const peak = Math.max(1, ...points.map((p) => p.amount));

  return (
    <View
      accessible
      accessibilityLabel={`Interest paid over time from ${formatShortMonth(points[0].month)} to ${formatShortMonth(points[points.length - 1].month)}`}
    >
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 12 }}>
        {points.map((p) => {
          const h = Math.max(4, (p.amount / peak) * 80);
          return (
            <View key={p.month} style={{ alignItems: "center", width: 40 }}>
              <View
                style={{
                  width: 18,
                  height: h,
                  backgroundColor: theme.colors.warning,
                  borderRadius: 2,
                }}
              />
              <Text style={{ color: theme.colors.textMuted, fontSize: 10, marginTop: 4 }}>
                {formatShortMonth(p.month)}
              </Text>
              <Text style={{ color: theme.colors.textSecondary, fontSize: 9, marginTop: 2 }}>
                {formatCurrency(p.amount)}
              </Text>
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}
