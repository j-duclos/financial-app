import React, { useMemo, useState } from "react";
import { FlatList, Pressable, RefreshControl, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { getBillsOverview, listRules } from "@budget-app/api-client";
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
  currentMonthKey,
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
  const month = currentMonthKey();
  const [sortKey, setSortKey] = useState<RecurringSortKey>("next");

  const rulesQuery = useQuery({
    queryKey: recurringQueryKeys.list(),
    queryFn: () => listRules(),
    staleTime: 60_000,
  });

  const overviewQuery = useQuery({
    queryKey: recurringQueryKeys.billsOverview(month),
    queryFn: () => getBillsOverview({ month, months_before: 0, months_after: 1 }),
    staleTime: 60_000,
  });

  const rows = useMemo(() => {
    const built = buildRecurringRows(
      rulesQuery.data?.results ?? [],
      overviewQuery.data?.checklist.items ?? [],
      todayStr()
    );
    return sortRecurringRows(built, sortKey);
  }, [rulesQuery.data?.results, overviewQuery.data?.checklist.items, sortKey]);

  const isLoading = rulesQuery.isLoading || overviewQuery.isLoading;
  const isError = rulesQuery.isError || overviewQuery.isError;
  const error = rulesQuery.error ?? overviewQuery.error;
  const isFetching = rulesQuery.isFetching || overviewQuery.isFetching;

  const refetch = () => {
    void rulesQuery.refetch();
    void overviewQuery.refetch();
  };

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
        <Text style={{ color: theme.colors.textSecondary, marginBottom: 12, ...theme.typography.body }}>
          Manage repeating income, bills, and transfers that drive your forecast.
        </Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 8 }}>
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
        <View style={{ padding: theme.spacing.lg, gap: 8 }}>
          <SkeletonBlock lines={3} />
          <SkeletonBlock lines={3} />
        </View>
      ) : isError ? (
        <ErrorState message={describeApiError(error)} onRetry={refetch} />
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
            <RefreshControl refreshing={isFetching && !isLoading} onRefresh={refetch} />
          }
          contentContainerStyle={{ paddingBottom: theme.spacing.xxl }}
        />
      )}
    </Screen>
  );
}
