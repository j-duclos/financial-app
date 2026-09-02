import React from "react";
import { FlatList, RefreshControl, Text, View } from "react-native";
import { useRouter } from "expo-router";
import {
  AppHeader,
  EmptyState,
  ErrorState,
  IconButton,
  Screen,
  SkeletonBlock,
} from "@/components/ui";
import { useTheme } from "@/theme";
import { describeApiError } from "@/services/api";
import { BudgetCategoryRow } from "./BudgetCategoryRow";
import { currentPeriodAnchor } from "./periodUtils";
import { useBudgetData } from "./useBudgetData";

export function SpendingLimitsScreen() {
  const theme = useTheme();
  const router = useRouter();
  const period = currentPeriodAnchor();
  const {
    rows,
    isLoading,
    isError,
    summaryError,
    error,
    pullRefreshing,
    refetch,
  } = useBudgetData(period);

  return (
    <Screen scroll={false} contentStyle={{ paddingHorizontal: 0 }}>
      <View style={{ paddingHorizontal: theme.spacing.lg }}>
        <AppHeader
          title="Spending Limits"
          onBack={() => router.back()}
          right={
            <IconButton
              name="plus"
              accessibilityLabel="Add spending limit"
              onPress={() => router.push("/spending-limits/new")}
            />
          }
        />
        {summaryError ? (
          <Text style={{ color: theme.colors.critical, fontSize: 13, marginBottom: 8 }}>
            Summary unavailable. Showing limits list.
          </Text>
        ) : null}
      </View>

      {isLoading ? (
        <View style={{ padding: theme.spacing.lg }}>
          <SkeletonBlock lines={4} />
        </View>
      ) : isError ? (
        <ErrorState message={describeApiError(error)} onRetry={refetch} />
      ) : rows.length === 0 ? (
        <EmptyState
          title="No spending limits"
          message="Set category limits to track how much you want to spend."
          actionLabel="Add limit"
          onAction={() => router.push("/spending-limits/new")}
        />
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(item) => String(item.target.id)}
          renderItem={({ item }) => (
            <BudgetCategoryRow
              row={item}
              onPress={() => router.push(`/spending-limits/edit/${item.target.id}`)}
            />
          )}
          refreshControl={<RefreshControl refreshing={pullRefreshing} onRefresh={refetch} />}
          contentContainerStyle={{ paddingBottom: theme.spacing.xxl }}
        />
      )}
    </Screen>
  );
}
