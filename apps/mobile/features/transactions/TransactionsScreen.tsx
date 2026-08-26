import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  Text,
  View,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import FontAwesome from "@expo/vector-icons/FontAwesome";
import { listAccounts, listCategories } from "@budget-app/api-client";
import {
  EmptyState,
  ErrorState,
  IconButton,
  Screen,
  SectionHeader,
  SkeletonBlock,
  TextField,
} from "@/components/ui";
import { useTheme } from "@/theme";
import { accountLifecycleStatus } from "@/lib/accountGroups";
import { describeApiError } from "@/services/api";
import {
  countActiveTransactionFilters,
  DEFAULT_TRANSACTION_FILTERS,
  type TransactionFilters,
} from "./types";
import { filtersFromSearchParams, transactionQueryKeys } from "./queryKeys";
import { useTransactionsData } from "./useTransactionsData";
import { TransactionRowCard } from "./TransactionRowCard";
import { TransactionFiltersSheet } from "./TransactionFiltersSheet";
import type { TransactionListRow } from "./buildTransactionList";

export function TransactionsScreen() {
  const theme = useTheme();
  const router = useRouter();
  const params = useLocalSearchParams<{ account?: string; category?: string; date?: string; dateFrom?: string; dateTo?: string }>();
  const [filters, setFilters] = useState<TransactionFilters>(() => ({
    ...DEFAULT_TRANSACTION_FILTERS,
    ...filtersFromSearchParams({
      account: params.account,
      category: params.category,
      date: params.date,
      dateFrom: params.dateFrom,
      dateTo: params.dateTo,
    }),
  }));

  useEffect(() => {
    setFilters((prev) => ({
      ...prev,
      ...filtersFromSearchParams({
        account: params.account,
        category: params.category,
        date: params.date,
        dateFrom: params.dateFrom,
        dateTo: params.dateTo,
      }),
    }));
  }, [params.account, params.category, params.date, params.dateFrom, params.dateTo]);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [filterDraft, setFilterDraft] = useState(filters);

  const accountsQuery = useQuery({
    queryKey: transactionQueryKeys.accountsPicker,
    queryFn: () => listAccounts({ active_only: true, page_size: 500 }),
    staleTime: 5 * 60_000,
  });

  const accounts = useMemo(
    () => (accountsQuery.data?.results ?? []).filter((a) => accountLifecycleStatus(a) === "active"),
    [accountsQuery.data?.results]
  );

  const householdId = filters.accountId
    ? accounts.find((a) => a.id === filters.accountId)?.household?.id ?? null
    : accounts[0]?.household?.id ?? null;

  const categoriesQuery = useQuery({
    queryKey: transactionQueryKeys.categories(householdId),
    queryFn: () => listCategories({ household: householdId ?? undefined }),
    enabled: householdId != null,
    staleTime: 5 * 60_000,
  });

  const {
    listRows,
    isLoading,
    isError,
    error,
    isFetchingNextPage,
    hasNextPage,
    fetchNextPage,
    refetch,
    historyQuery,
  } = useTransactionsData(filters);

  const activeFilterCount = countActiveTransactionFilters(filters);

  const onEndReached = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const renderItem = useCallback(
    ({ item }: { item: TransactionListRow }) => {
      if (item.kind === "section") {
        return <SectionHeader title={item.title} />;
      }
      if (item.kind === "upcoming") {
        return (
          <Pressable
            onPress={() => {
              if (item.row.transaction_id) {
                router.push(`/transaction/${item.row.transaction_id}`);
              }
            }}
          >
            <TransactionRowCard timelineRow={item.row} runningBalance={item.runningBalance} />
          </Pressable>
        );
      }
      return (
        <Pressable onPress={() => router.push(`/transaction/${item.txn.id}`)}>
          <TransactionRowCard txn={item.txn} runningBalance={item.runningBalance} />
        </Pressable>
      );
    },
    [router]
  );

  const keyExtractor = useCallback((item: TransactionListRow) => item.id, []);

  return (
    <Screen edges={["top", "left", "right"]} contentStyle={{ paddingHorizontal: 0 }}>
      <View style={{ paddingHorizontal: theme.spacing.lg, paddingBottom: theme.spacing.sm }}>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
          <Text style={{ color: theme.colors.text, ...theme.typography.title }}>Transactions</Text>
          <View style={{ flexDirection: "row", gap: 4 }}>
            <IconButton
              name="filter"
              accessibilityLabel={activeFilterCount > 0 ? `Filters, ${activeFilterCount} active` : "Filters"}
              onPress={() => {
                setFilterDraft(filters);
                setFiltersOpen(true);
              }}
            />
            <IconButton
              name="plus"
              accessibilityLabel="Add transaction"
              onPress={() =>
                router.push(
                  filters.accountId
                    ? `/transaction/new?account=${filters.accountId}`
                    : "/transaction/new"
                )
              }
            />
          </View>
        </View>
        <TextField
          label="Search"
          value={filters.search}
          onChangeText={(search) => setFilters((prev) => ({ ...prev, search }))}
          placeholder="Payee or memo"
          style={{ marginTop: theme.spacing.sm }}
        />
        {filters.accountId != null ? (
          <Pressable
            onPress={() => setFilters((prev) => ({ ...prev, accountId: null }))}
            style={{ marginTop: theme.spacing.sm, flexDirection: "row", alignItems: "center", gap: 6 }}
          >
            <FontAwesome name="times-circle" size={14} color={theme.colors.tint} />
            <Text style={{ color: theme.colors.tint, ...theme.typography.caption }}>
              Account filter active — tap to clear
            </Text>
          </Pressable>
        ) : null}
      </View>

      {isLoading ? (
        <View style={{ padding: theme.spacing.lg, gap: 8 }}>
          <SkeletonBlock lines={3} />
          <SkeletonBlock lines={3} />
          <SkeletonBlock lines={3} />
        </View>
      ) : isError ? (
        <ErrorState message={describeApiError(error)} onRetry={() => void refetch()} />
      ) : listRows.length === 0 ? (
        <EmptyState
          title="No transactions"
          message={
            activeFilterCount > 0 || filters.search.trim()
              ? "No transactions match your filters. Try clearing filters or widening the date range."
              : "Add a transaction or connect an account to see activity here."
          }
          actionLabel={activeFilterCount > 0 ? "Clear filters" : undefined}
          onAction={
            activeFilterCount > 0
              ? () => setFilters(DEFAULT_TRANSACTION_FILTERS)
              : undefined
          }
        />
      ) : (
        <FlatList
          data={listRows}
          renderItem={renderItem}
          keyExtractor={keyExtractor}
          onEndReached={onEndReached}
          onEndReachedThreshold={0.4}
          refreshControl={
            <RefreshControl
              refreshing={historyQuery.isFetching && !isLoading}
              onRefresh={() => void refetch()}
              tintColor={theme.colors.tint}
            />
          }
          ListFooterComponent={
            isFetchingNextPage ? (
              <View style={{ padding: theme.spacing.lg }}>
                <ActivityIndicator color={theme.colors.tint} />
              </View>
            ) : null
          }
          contentContainerStyle={{ paddingBottom: theme.spacing.xxl }}
        />
      )}

      <TransactionFiltersSheet
        visible={filtersOpen}
        draft={filterDraft}
        accounts={accounts}
        categories={categoriesQuery.data?.results ?? []}
        onClose={() => setFiltersOpen(false)}
        onApply={(next) => {
          setFilters(next);
          setFiltersOpen(false);
        }}
      />
    </Screen>
  );
}
