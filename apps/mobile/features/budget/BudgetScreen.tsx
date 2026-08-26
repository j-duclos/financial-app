import React, { useMemo, useState } from "react";
import { FlatList, Pressable, RefreshControl, Text, View } from "react-native";
import { useRouter } from "expo-router";
import {
  EmptyState,
  ErrorState,
  IconButton,
  Screen,
  SkeletonBlock,
} from "@/components/ui";
import { useTheme } from "@/theme";
import { describeApiError } from "@/services/api";
import { BudgetSummaryCard } from "./BudgetSummaryCard";
import { BudgetCategoryRow } from "./BudgetCategoryRow";
import { PeriodSelector } from "./PeriodSelector";
import { currentPeriodAnchor, shiftPeriodAnchor } from "./periodUtils";
import { sortBudgetRows } from "./spendingTargetDisplay";
import { useBudgetData } from "./useBudgetData";
import type { BudgetSortKey } from "./types";

const SORT_OPTIONS: { key: BudgetSortKey; label: string }[] = [
  { key: "over", label: "Over first" },
  { key: "utilization", label: "Highest use" },
  { key: "spent", label: "Most spent" },
  { key: "name", label: "Name" },
];

export function BudgetScreen() {
  const theme = useTheme();
  const router = useRouter();
  const [period, setPeriod] = useState(currentPeriodAnchor);
  const [sortKey, setSortKey] = useState<BudgetSortKey>("over");

  const { summary, rows, isLoading, isError, error, isFetching, refetch } = useBudgetData(period);

  const sortedRows = useMemo(() => sortBudgetRows(rows, sortKey), [rows, sortKey]);

  return (
    <Screen scroll={false} contentStyle={{ paddingHorizontal: 0 }}>
      <View style={{ paddingHorizontal: theme.spacing.lg }}>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
          <Text style={{ color: theme.colors.text, ...theme.typography.title }} accessibilityRole="header">
            Budget
          </Text>
          <View style={{ flexDirection: "row", gap: 4 }}>
            <IconButton
              name="list"
              accessibilityLabel="Manage spending limits"
              onPress={() => router.push("/spending-limits")}
            />
            <IconButton
              name="plus"
              accessibilityLabel="Add spending limit"
              onPress={() => router.push("/spending-limits/new")}
            />
          </View>
        </View>
        <Text style={{ color: theme.colors.textSecondary, marginBottom: 12, ...theme.typography.body }}>
          Track category spending against your limits.
        </Text>
        <PeriodSelector
          period={period}
          onPrev={() => setPeriod((p) => shiftPeriodAnchor(p, -1))}
          onNext={() => setPeriod((p) => shiftPeriodAnchor(p, 1))}
          onToday={() => setPeriod(currentPeriodAnchor())}
        />
        {summary ? <BudgetSummaryCard summary={summary} /> : null}
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginVertical: 12 }}>
          {SORT_OPTIONS.map((opt) => (
            <Pressable
              key={opt.key}
              onPress={() => setSortKey(opt.key)}
              accessibilityRole="button"
              accessibilityState={{ selected: sortKey === opt.key }}
              style={{
                paddingHorizontal: 10,
                paddingVertical: 6,
                borderRadius: 999,
                backgroundColor: sortKey === opt.key ? theme.colors.tintMuted : theme.colors.surfaceMuted,
              }}
            >
              <Text
                style={{
                  color: sortKey === opt.key ? theme.colors.tint : theme.colors.text,
                  fontWeight: "600",
                  fontSize: 12,
                }}
              >
                {opt.label}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>

      {isLoading ? (
        <View style={{ padding: theme.spacing.lg }}>
          <SkeletonBlock lines={4} />
        </View>
      ) : isError ? (
        <ErrorState message={describeApiError(error)} onRetry={refetch} />
      ) : sortedRows.length === 0 ? (
        <EmptyState
          title="No spending limits"
          message="Set category limits to track how much you want to spend."
          actionLabel="Add limit"
          onAction={() => router.push("/spending-limits/new")}
        />
      ) : (
        <FlatList
          data={sortedRows}
          keyExtractor={(item) => String(item.target.id)}
          renderItem={({ item }) => (
            <BudgetCategoryRow
              row={item}
              onPress={() =>
                router.push({
                  pathname: "/budget/[targetId]",
                  params: {
                    targetId: String(item.target.id),
                    anchor: period.anchor,
                  },
                })
              }
            />
          )}
          refreshControl={
            <RefreshControl refreshing={isFetching && !isLoading} onRefresh={refetch} />
          }
          contentContainerStyle={{ paddingBottom: theme.spacing.xxl }}
        />
      )}
    </Screen>
  );
}
