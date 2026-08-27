import React, { useMemo } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import type { MonthlySummary } from "@budget-app/shared";
import { formatCurrency } from "@budget-app/shared";
import { useTheme } from "@/theme";
import { formatShortMonth, parseAmount } from "../reportDisplay";
import type { ReportHistoryMonths } from "../types";

type TrendPoint = Pick<MonthlySummary, "month" | "total_income" | "total_expenses">;

const CHART_HEIGHT = 64;
const BAR_WIDTH = 12;
const COLUMN_WIDTH = 36;

export function IncomeExpenseTrendChart({
  trend,
  historyMonths,
}: {
  trend: TrendPoint[];
  historyMonths?: ReportHistoryMonths;
}) {
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
  const rangeLabel =
    points.length > 1
      ? `${formatShortMonth(points[0].month)} – ${formatShortMonth(points[points.length - 1].month)}`
      : formatShortMonth(points[0].month);
  const windowLabel = historyMonths ? `${historyMonths}-month window` : `${points.length} months`;
  const summary = `Income versus expenses, ${windowLabel}: ${rangeLabel}`;

  return (
    <View accessible accessibilityLabel={summary}>
      <Text style={{ color: theme.colors.textSecondary, fontSize: 12, marginBottom: 8 }}>{summary}</Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={points.length > 8}
        contentContainerStyle={{ gap: 8, paddingBottom: 2, minWidth: "100%" }}
      >
        {points.map((p) => {
          const incomeH = Math.max(3, (p.income / peak) * CHART_HEIGHT);
          const expenseH = Math.max(3, (p.expense / peak) * CHART_HEIGHT);
          return (
            <View key={p.month} style={{ alignItems: "center", width: COLUMN_WIDTH }}>
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "flex-end",
                  height: CHART_HEIGHT + 4,
                  gap: 2,
                }}
              >
                <View
                  accessibilityLabel={`${formatShortMonth(p.month)} income ${formatCurrency(p.income)}`}
                  style={{
                    width: BAR_WIDTH,
                    height: incomeH,
                    backgroundColor: theme.colors.moneyPositive,
                    borderRadius: 2,
                  }}
                />
                <View
                  accessibilityLabel={`${formatShortMonth(p.month)} expenses ${formatCurrency(p.expense)}`}
                  style={{
                    width: BAR_WIDTH,
                    height: expenseH,
                    backgroundColor: theme.colors.moneyNegative,
                    borderRadius: 2,
                    opacity: 0.85,
                  }}
                />
              </View>
              <Text style={{ color: theme.colors.textMuted, fontSize: 11, marginTop: 4 }}>
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
            style={{
              width: 10,
              height: 10,
              borderRadius: 2,
              backgroundColor: theme.colors.moneyNegative,
              opacity: 0.85,
            }}
          />
          <Text style={{ color: theme.colors.textMuted, fontSize: 11 }}>Expenses</Text>
        </View>
      </View>
    </View>
  );
}

export function CashFlowHistorySelector({
  value,
  onChange,
}: {
  value: ReportHistoryMonths;
  onChange: (months: ReportHistoryMonths) => void;
}) {
  const theme = useTheme();
  const options: ReportHistoryMonths[] = [6, 12];

  return (
    <View
      style={{ flexDirection: "row", gap: 8, marginBottom: 12 }}
      accessibilityRole="tablist"
      accessibilityLabel="Cash flow history range"
    >
      {options.map((months) => {
        const selected = value === months;
        return (
          <Pressable
            key={months}
            onPress={() => onChange(months)}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            accessibilityLabel={`${months} months`}
            style={{
              paddingHorizontal: 12,
              paddingVertical: 8,
              borderRadius: 8,
              minHeight: theme.touchTarget,
              justifyContent: "center",
              backgroundColor: selected ? theme.colors.tintMuted : theme.colors.surfaceMuted,
            }}
          >
            <Text
              style={{
                color: selected ? theme.colors.tint : theme.colors.text,
                fontWeight: "600",
                fontSize: 13,
              }}
            >
              {months} months
            </Text>
          </Pressable>
        );
      })}
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
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10 }}>
        {points.map((p) => {
          const h = Math.max(4, (p.amount / peak) * CHART_HEIGHT);
          return (
            <View key={p.month} style={{ alignItems: "center", width: 40 }}>
              <View
                style={{
                  width: 16,
                  height: h,
                  backgroundColor: theme.colors.warning,
                  borderRadius: 2,
                }}
              />
              <Text style={{ color: theme.colors.textMuted, fontSize: 11, marginTop: 4 }}>
                {formatShortMonth(p.month)}
              </Text>
              <Text style={{ color: theme.colors.textSecondary, fontSize: 10, marginTop: 2 }}>
                {formatCurrency(p.amount)}
              </Text>
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}
