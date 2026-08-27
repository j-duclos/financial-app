import React, { useState } from "react";
import { ActivityIndicator, FlatList, Pressable, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useInfiniteQuery } from "@tanstack/react-query";
import { formatCurrency, formatShortMonthDay } from "@budget-app/shared";
import { listGoalContributions } from "@budget-app/api-client";
import {
  AppHeader,
  EmptyState,
  ErrorState,
  Screen,
  SkeletonBlock,
} from "@/components/ui";
import { useTheme } from "@/theme";
import { describeApiError } from "@/services/api";
import { goalDetailPath } from "./navigation";
import { goalsQueryKeys } from "./queryKeys";

const PAGE_SIZE = 25;

export function GoalContributionHistoryScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const goalId = Number(id);
  const [refreshing, setRefreshing] = useState(false);

  const query = useInfiniteQuery({
    queryKey: goalsQueryKeys.contributions(goalId),
    queryFn: ({ pageParam }) =>
      listGoalContributions({ bucket: goalId, page: pageParam, page_size: PAGE_SIZE }),
    initialPageParam: 1,
    getNextPageParam: (lastPage, _pages, lastPageParam) => {
      if (!lastPage.next) return undefined;
      return lastPageParam + 1;
    },
    enabled: Number.isInteger(goalId) && goalId > 0,
  });

  const rows = query.data?.pages.flatMap((p) => p.results) ?? [];

  if (!Number.isInteger(goalId) || goalId <= 0) {
    return (
      <Screen scroll={false}>
        <EmptyState title="Invalid goal" message="This goal link is not valid." />
      </Screen>
    );
  }

  return (
    <Screen scroll={false} contentStyle={{ paddingHorizontal: 0 }}>
      <View style={{ paddingHorizontal: theme.spacing.lg }}>
        <AppHeader
          title="Contribution history"
          onBack={() => router.push(goalDetailPath(goalId))}
        />
      </View>

      {query.isLoading ? (
        <View style={{ paddingHorizontal: theme.spacing.lg }}>
          <SkeletonBlock lines={8} />
        </View>
      ) : query.isError ? (
        <View style={{ paddingHorizontal: theme.spacing.lg }}>
          <ErrorState message={describeApiError(query.error)} onRetry={() => query.refetch()} />
        </View>
      ) : rows.length === 0 ? (
        <View style={{ paddingHorizontal: theme.spacing.lg }}>
          <EmptyState title="No contributions yet" message="Funding activity will show up here." />
        </View>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(item) => String(item.id)}
          contentContainerStyle={{
            paddingHorizontal: theme.spacing.lg,
            paddingBottom: theme.spacing.xxl,
          }}
          refreshing={refreshing}
          onRefresh={async () => {
            setRefreshing(true);
            try {
              await query.refetch();
            } finally {
              setRefreshing(false);
            }
          }}
          onEndReached={() => {
            if (query.hasNextPage && !query.isFetchingNextPage) {
              void query.fetchNextPage();
            }
          }}
          onEndReachedThreshold={0.4}
          ListFooterComponent={
            query.isFetchingNextPage ? (
              <ActivityIndicator style={{ marginVertical: 16 }} color={theme.colors.tint} />
            ) : null
          }
          renderItem={({ item }) => {
            const negative = parseFloat(item.amount) < 0;
            return (
              <View
                style={{
                  flexDirection: "row",
                  justifyContent: "space-between",
                  paddingVertical: 12,
                  borderBottomWidth: 1,
                  borderBottomColor: theme.colors.border,
                  gap: 12,
                }}
              >
                <View style={{ flex: 1 }}>
                  <Text
                    style={{
                      color: negative ? theme.colors.warning : theme.colors.text,
                      fontWeight: "700",
                    }}
                  >
                    {formatCurrency(item.amount)}
                  </Text>
                  <Text style={{ color: theme.colors.textMuted, ...theme.typography.caption, marginTop: 2 }}>
                    {item.account_name ?? "Account"} · {item.source}
                  </Text>
                </View>
                <Text style={{ color: theme.colors.textMuted, ...theme.typography.caption }}>
                  {formatShortMonthDay(item.date)}
                </Text>
              </View>
            );
          }}
        />
      )}

      {rows.length > 0 ? (
        <Pressable
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={{ height: 0 }}
        />
      ) : null}
    </Screen>
  );
}
