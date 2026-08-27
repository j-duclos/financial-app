import React, { useMemo, useState } from "react";
import { FlatList, Pressable, RefreshControl, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { listRules } from "@budget-app/api-client";
import {
  AppHeader,
  EmptyState,
  ErrorState,
  IconButton,
  Screen,
  SkeletonBlock,
} from "@/components/ui";
import { useTheme } from "@/theme";
import { todayStr } from "@/lib/dates";
import { describeApiError } from "@/services/api";
import { recurringQueryKeys } from "./queryKeys";
import { RecurringRow } from "./RecurringRow";
import {
  buildRecurringRows,
  sortRecurringRows,
  type RecurringSortKey,
} from "./recurringDisplay";

const SORT_OPTIONS: { key: RecurringSortKey; label: string }[] = [
  { key: "next", label: "Next" },
  { key: "name", label: "Name" },
  { key: "amount", label: "Amount" },
  { key: "account", label: "Account" },
];

export function RecurringListScreen() {
  const theme = useTheme();
  const router = useRouter();
  const [sortKey, setSortKey] = useState<RecurringSortKey>("next");

  const rulesQuery = useQuery({
    queryKey: recurringQueryKeys.list(),
    queryFn: () => listRules(),
    staleTime: 60_000,
  });

  const rows = useMemo(() => {
    const built = buildRecurringRows(rulesQuery.data?.results ?? [], todayStr());
    return sortRecurringRows(built, sortKey);
  }, [rulesQuery.data?.results, sortKey]);

  const isLoading = rulesQuery.isLoading;
  const isError = rulesQuery.isError;
  const isFetching = rulesQuery.isFetching;

  return (
    <Screen scroll={false} contentStyle={{ paddingHorizontal: 0 }}>
      <View style={{ paddingHorizontal: theme.spacing.lg }}>
        <AppHeader
          title="Recurring"
          showBack
          right={
            <IconButton
              name="plus"
              accessibilityLabel="Add recurring transaction"
              onPress={() => router.push("/recurring/new")}
            />
          }
        />
        <View
          style={{
            flexDirection: "row",
            flexWrap: "wrap",
            gap: 6,
            marginBottom: 8,
            marginTop: -4,
          }}
        >
          {SORT_OPTIONS.map((opt) => {
            const selected = sortKey === opt.key;
            return (
              <Pressable
                key={opt.key}
                onPress={() => setSortKey(opt.key)}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                style={{
                  paddingHorizontal: 10,
                  paddingVertical: 5,
                  borderRadius: 999,
                  backgroundColor: selected ? theme.colors.tintMuted : "transparent",
                  borderWidth: 1,
                  borderColor: selected ? theme.colors.tint : theme.colors.border,
                }}
              >
                <Text
                  style={{
                    color: selected ? theme.colors.tint : theme.colors.textSecondary,
                    fontWeight: selected ? "700" : "500",
                    fontSize: 12,
                  }}
                >
                  {opt.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      {isLoading ? (
        <View style={{ padding: theme.spacing.lg, gap: 8 }}>
          <SkeletonBlock lines={3} />
          <SkeletonBlock lines={3} />
        </View>
      ) : isError ? (
        <ErrorState message={describeApiError(rulesQuery.error)} onRetry={() => rulesQuery.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState
          title="No recurring transactions"
          message="Add recurring income or bills to make your forecast more accurate."
          actionLabel="Add recurring"
          onAction={() => router.push("/recurring/new")}
        />
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(item) => String(item.rule.id)}
          renderItem={({ item }) => (
            <RecurringRow row={item} onPress={() => router.push(`/recurring/${item.rule.id}`)} />
          )}
          refreshControl={
            <RefreshControl
              refreshing={isFetching && !isLoading}
              onRefresh={() => void rulesQuery.refetch()}
            />
          }
          contentContainerStyle={{ paddingBottom: theme.spacing.xxl }}
        />
      )}
    </Screen>
  );
}
