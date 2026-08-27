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
import FontAwesome from "@expo/vector-icons/FontAwesome";
import {
  EmptyState,
  ErrorState,
  IconButton,
  Screen,
  SkeletonBlock,
  TextField,
} from "@/components/ui";
import { useTheme } from "@/theme";
import { FINANCIAL_LIST_PROPS } from "@/lib/flatListDefaults";
import { resolveHouseholdId } from "@/lib/householdContext";
import { describeApiError } from "@/services/api";
import { useDefaultHouseholdId } from "@/hooks/useDefaultHouseholdId";
import { useAccountOptions } from "@/hooks/useAccountOptions";
import { useCategoryOptions } from "@/hooks/useCategoryOptions";
import {
  countActiveTransactionFilters,
  DEFAULT_TRANSACTION_FILTERS,
  type TransactionFilters,
} from "./types";
import { filtersFromSearchParams } from "./queryKeys";
import { useTransactionsData } from "./useTransactionsData";
import { TransactionListItem } from "./TransactionListItem";
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
  const [searchInput, setSearchInput] = useState(filters.search);

  useEffect(() => {
    setSearchInput(filters.search);
  }, [filters.search]);

  const onSearchChange = useCallback((text: string) => {
    setSearchInput(text);
    setFilters((prev) => (prev.search === text ? prev : { ...prev, search: text }));
  }, []);

  const { householdId: defaultHouseholdId, isReady: householdReady } = useDefaultHouseholdId();
  const accountOptionsQuery = useAccountOptions({ householdId: defaultHouseholdId });
  const accounts = accountOptionsQuery.accounts;

  const householdId = resolveHouseholdId(defaultHouseholdId, filters.accountId, accounts);
  const categoriesQuery = useCategoryOptions({ householdId });

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

  const onPressTransaction = useCallback(
    (id: number) => {
      router.push(`/transaction/${id}`);
    },
    [router]
  );

  const renderItem = useCallback(
    ({ item }: { item: TransactionListRow }) => (
      <TransactionListItem item={item} onPressTransaction={onPressTransaction} />
    ),
    [onPressTransaction]
  );

  const keyExtractor = useCallback((item: TransactionListRow) => item.id, []);

  if (!householdReady) {
    return (
      <Screen edges={["top", "left", "right"]}>
        <View style={{ padding: theme.spacing.lg, gap: 8 }}>
          <SkeletonBlock lines={3} />
          <SkeletonBlock lines={3} />
        </View>
      </Screen>
    );
  }

  if (defaultHouseholdId == null && filters.accountId == null) {
    return (
      <Screen edges={["top", "left", "right"]}>
        <EmptyState
          title="Default household required"
          message="Set a default household in Profile & Settings on web, or filter by account."
        />
      </Screen>
    );
  }

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
          value={searchInput}
          onChangeText={onSearchChange}
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
          {...FINANCIAL_LIST_PROPS}
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
        accountsLoading={accountOptionsQuery.isLoading && accounts.length === 0}
        accountsError={accountOptionsQuery.isError}
        categories={categoriesQuery.categories}
        categoriesLoading={categoriesQuery.isLoading && categoriesQuery.categories.length === 0}
        categoriesError={categoriesQuery.isError}
        onClose={() => setFiltersOpen(false)}
        onApply={(next) => {
          setFilters(next);
          setFiltersOpen(false);
        }}
      />
    </Screen>
  );
}
