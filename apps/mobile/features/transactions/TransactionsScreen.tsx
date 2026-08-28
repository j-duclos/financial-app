import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  View,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { getEffectiveDisplayName } from "@budget-app/shared";
import {
  OPERATIONAL_FORECAST_DAY_OPTIONS,
  type OperationalForecastDays,
} from "@budget-app/shared";
import {
  BottomSheet,
  EmptyState,
  ErrorState,
  IconButton,
  Screen,
  SkeletonBlock,
} from "@/components/ui";
import { useTheme } from "@/theme";
import { FINANCIAL_LIST_PROPS } from "@/lib/flatListDefaults";
import { describeApiError } from "@/services/api";
import { useDefaultHouseholdId } from "@/hooks/useDefaultHouseholdId";
import { useAccountOptions } from "@/hooks/useAccountOptions";
import { useProfile } from "@/lib/profileQuery";
import { usePageForecastWindow } from "@/hooks/usePageForecastWindow";
import {
  RECENT_RANGE_OPTIONS,
  TIME_FILTER_LABELS,
} from "@/lib/transactionsLedger";
import {
  countActiveTransactionFilters,
  clearTransactionFiltersPreservingAccount,
  DEFAULT_TRANSACTION_FILTERS,
  type TransactionFilters,
} from "./types";
import { filtersFromSearchParams } from "./queryKeys";
import { useTransactionsData } from "./useTransactionsData";
import { TransactionListItem } from "./TransactionListItem";
import { TransactionFiltersSheet } from "./TransactionFiltersSheet";
import { AccountSelectorSheet } from "./AccountSelectorSheet";
import { AccountLedgerHeader } from "./AccountLedgerHeader";
import type { TransactionListRow } from "./buildTransactionList";
import {
  estimateLedgerOffset,
  getLedgerItemLayout,
  ledgerAnchorScrollIndex,
} from "./ledgerScrollAnchor";
import { markAttentionNavigation } from "@/features/dashboard/attentionNavigationTiming";
import {
  parseRouteAccountId,
  rememberTransactionAccountSelection,
  resolveInitialTransactionAccount,
} from "./accountSelection";

function listHasActivityRows(rows: TransactionListRow[]): boolean {
  return rows.some(
    (r) => r.kind === "history" || r.kind === "pending" || r.kind === "upcoming"
  );
}

function listIsOnlyPlaceholders(rows: TransactionListRow[]): boolean {
  return (
    rows.length > 0 &&
    rows.every((r) => r.kind === "section" || r.kind === "skeleton")
  );
}

export function TransactionsScreen() {
  const theme = useTheme();
  const router = useRouter();
  const params = useLocalSearchParams<{
    account?: string;
    accountName?: string;
    category?: string;
    date?: string;
    dateFrom?: string;
    dateTo?: string;
  }>();
  const routeAccountId = parseRouteAccountId(params.account);
  const routeFilters = filtersFromSearchParams({
    account: params.account,
    category: params.category,
    date: params.date,
    dateFrom: params.dateFrom,
    dateTo: params.dateTo,
  });

  const [filters, setFilters] = useState<TransactionFilters>(() => ({
    ...DEFAULT_TRANSACTION_FILTERS,
    ...routeFilters,
    accountId: routeAccountId,
  }));
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [accountSelectorOpen, setAccountSelectorOpen] = useState(false);
  const [recentRangeOpen, setRecentRangeOpen] = useState(false);
  const [upcomingRangeOpen, setUpcomingRangeOpen] = useState(false);
  const [filterDraft, setFilterDraft] = useState(filters);
  const accountInitializedRef = useRef(false);
  const listRef = useRef<FlatList<TransactionListRow>>(null);

  const { householdId: defaultHouseholdId, isReady: householdReady } = useDefaultHouseholdId();
  const { data: profile } = useProfile();
  const { forecastDays, setForecastDays, ready: forecastReady } = usePageForecastWindow();
  const accountOptionsQuery = useAccountOptions({ householdId: defaultHouseholdId });
  const accounts = accountOptionsQuery.accounts;

  const selectedAccount = useMemo(
    () => accounts.find((a) => a.id === filters.accountId) ?? null,
    [accounts, filters.accountId]
  );

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
      ...(routeAccountId != null ? { accountId: routeAccountId } : {}),
    }));
  }, [params.account, params.category, params.date, params.dateFrom, params.dateTo, routeAccountId]);

  useEffect(() => {
    if (routeAccountId != null) {
      rememberTransactionAccountSelection(routeAccountId);
      accountInitializedRef.current = true;
      return;
    }
    if (accountInitializedRef.current || accounts.length === 0) return;

    const resolved = resolveInitialTransactionAccount({
      routeAccountId: null,
      defaultAccountId: profile?.default_account ?? null,
      accounts,
    });
    if (resolved != null) {
      setFilters((prev) => (prev.accountId === resolved ? prev : { ...prev, accountId: resolved }));
      rememberTransactionAccountSelection(resolved);
    }
    accountInitializedRef.current = true;
  }, [routeAccountId, accounts, profile?.default_account]);

  useEffect(() => {
    if (filters.accountId != null) {
      rememberTransactionAccountSelection(filters.accountId);
    }
  }, [filters.accountId]);

  const onSelectAccount = useCallback((accountId: number) => {
    setFilters((prev) => ({ ...prev, accountId }));
    rememberTransactionAccountSelection(accountId);
  }, []);

  const {
    listRows,
    isError,
    error,
    isFetchingNextPage,
    hasNextPage,
    fetchNextPage,
    refetch,
    historyQuery,
    timelineQuery,
    headerForecastBalance,
    headerCurrentFromLedger,
    isRecentLoading,
    isTimelineLoading,
  } = useTransactionsData(filters, {
    forecastDays,
    forecastReady,
    householdId: defaultHouseholdId,
  });

  const ledgerListKey = `${filters.accountId ?? "none"}-${filters.timeFilter}-${forecastDays}`;
  const ledgerDataReady =
    !isRecentLoading &&
    !isTimelineLoading &&
    !listIsOnlyPlaceholders(listRows) &&
    listHasActivityRows(listRows);
  const ledgerAnchorIndex = useMemo(() => {
    if (!ledgerDataReady) return null;
    return ledgerAnchorScrollIndex(listRows);
  }, [listRows, ledgerDataReady]);

  /** Remount once data is ready so initialScrollIndex applies (scrollToIndex is unreliable without prior layout). */
  const listMountKey = `${ledgerListKey}:${ledgerDataReady ? "ready" : "loading"}`;
  const initialScrollIndex = useMemo(() => {
    if (!ledgerDataReady || ledgerAnchorIndex == null) return 0;
    return Math.max(0, Math.min(ledgerAnchorIndex, Math.max(0, listRows.length - 1)));
  }, [ledgerDataReady, ledgerAnchorIndex, listRows.length]);

  const getItemLayout = useCallback(
    (_data: ArrayLike<TransactionListRow> | null | undefined, index: number) =>
      getLedgerItemLayout(listRows, index),
    [listRows]
  );

  useEffect(() => {
    if (!ledgerDataReady || initialScrollIndex <= 0) return;
    const offset = estimateLedgerOffset(listRows, initialScrollIndex);
    const timer = setTimeout(() => {
      listRef.current?.scrollToOffset({ offset, animated: false });
    }, 32);
    return () => clearTimeout(timer);
  }, [listMountKey, ledgerDataReady, initialScrollIndex, listRows]);

  const activeFilterCount = countActiveTransactionFilters(filters);
  const selectedAccountName =
    selectedAccount != null
      ? getEffectiveDisplayName(selectedAccount)
      : typeof params.accountName === "string" && params.accountName.trim()
        ? params.accountName.trim()
        : "Account";

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
      <TransactionListItem
        item={item}
        onPressTransaction={onPressTransaction}
        onPressRecentRange={() => setRecentRangeOpen(true)}
        onPressUpcomingRange={() => setUpcomingRangeOpen(true)}
      />
    ),
    [onPressTransaction]
  );

  const keyExtractor = useCallback((item: TransactionListRow) => item.id, []);

  const hasAccountDeepLink = routeAccountId != null;
  const waitingForAccount =
    filters.accountId == null &&
    (accountOptionsQuery.isLoading || (accounts.length === 0 && !accountOptionsQuery.isError));

  const hasActivity = listHasActivityRows(listRows);
  const placeholdersOnly = listIsOnlyPlaceholders(listRows);
  const stillLoadingLedger =
    isRecentLoading || isTimelineLoading || historyQuery.isPending || timelineQuery.isPending;
  const showEmpty =
    filters.accountId != null &&
    !stillLoadingLedger &&
    !hasActivity &&
    !placeholdersOnly &&
    !isError;

  useEffect(() => {
    markAttentionNavigation("transactions-mounted");
  }, []);

  useEffect(() => {
    if (hasActivity) {
      markAttentionNavigation("transactions-first-rows");
      if (__DEV__) {
        const activityCount = listRows.filter(
          (r) => r.kind === "history" || r.kind === "pending" || r.kind === "upcoming"
        ).length;
        console.debug(
          `[PERF] transactions first_rows_visible count=${activityCount} ` +
            `timeline_status=${timelineQuery.fetchStatus} timeline_fetched=${timelineQuery.isFetched}`
        );
      }
    }
  }, [hasActivity, listRows, timelineQuery.fetchStatus, timelineQuery.isFetched]);

  useEffect(() => {
    if (historyQuery.isFetched) {
      markAttentionNavigation("transactions-first-network");
    }
  }, [historyQuery.isFetched]);

  useEffect(() => {
    if (timelineQuery.isFetched) {
      markAttentionNavigation("transactions-timeline");
    }
  }, [timelineQuery.isFetched]);

  if (!householdReady && !hasAccountDeepLink && accounts.length === 0) {
    return (
      <Screen edges={["top", "left", "right"]}>
        <View style={{ padding: theme.spacing.lg, gap: 8 }}>
          <SkeletonBlock lines={3} />
          <SkeletonBlock lines={3} />
        </View>
      </Screen>
    );
  }

  if (accounts.length === 0 && !accountOptionsQuery.isLoading) {
    return (
      <Screen edges={["top", "left", "right"]}>
        <View style={{ padding: theme.spacing.lg }}>
          <Text style={{ color: theme.colors.text, ...theme.typography.title }}>Transactions</Text>
          <EmptyState
            title="No accounts yet"
            message="Add an account to start tracking transactions."
            actionLabel="Add account"
            onAction={() => router.push("/account/new")}
          />
        </View>
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
              name="search"
              accessibilityLabel={
                filters.search.trim() ? `Search active: ${filters.search}` : "Search"
              }
              onPress={() => {
                setFilterDraft(filters);
                setFiltersOpen(true);
              }}
            />
            <IconButton
              name="filter"
              accessibilityLabel={
                activeFilterCount > 0 ? `Filters, ${activeFilterCount} active` : "Filters"
              }
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

        {filters.accountId != null ? (
          <AccountLedgerHeader
            accountId={filters.accountId}
            fallbackAccount={selectedAccount}
            forecastBalance={headerForecastBalance}
            ledgerCurrentBalance={headerCurrentFromLedger}
            forecastDays={forecastDays}
            onPressAccount={() => setAccountSelectorOpen(true)}
            accountNameFallback={selectedAccountName}
          />
        ) : null}
      </View>

      {waitingForAccount ? (
        <View style={{ padding: theme.spacing.lg, gap: 8 }}>
          <SkeletonBlock lines={3} />
          <SkeletonBlock lines={3} />
        </View>
      ) : filters.accountId == null ? (
        <EmptyState
          title="Select an account"
          message="Choose an account to view its transaction ledger."
          actionLabel="Choose account"
          onAction={() => setAccountSelectorOpen(true)}
        />
      ) : isError && !hasActivity ? (
        <ErrorState message={describeApiError(error)} onRetry={() => void refetch()} />
      ) : showEmpty ? (
        <EmptyState
          title={`No transactions for ${selectedAccountName}`}
          message={
            activeFilterCount > 0 || filters.search.trim()
              ? `No ${selectedAccountName} transactions match these filters.`
              : "Add a transaction to see activity in this account."
          }
          actionLabel={activeFilterCount > 0 || filters.search.trim() ? "Clear filters" : undefined}
          onAction={
            activeFilterCount > 0 || filters.search.trim()
              ? () =>
                  setFilters((prev) => clearTransactionFiltersPreservingAccount(prev.accountId))
              : undefined
          }
        />
      ) : (
        <FlatList
          ref={listRef}
          key={listMountKey}
          data={listRows}
          renderItem={renderItem}
          keyExtractor={keyExtractor}
          onEndReached={onEndReached}
          onEndReachedThreshold={0.4}
          {...FINANCIAL_LIST_PROPS}
          initialNumToRender={Math.max(
            FINANCIAL_LIST_PROPS.initialNumToRender,
            initialScrollIndex + 8
          )}
          initialScrollIndex={initialScrollIndex > 0 ? initialScrollIndex : undefined}
          getItemLayout={getItemLayout}
          onScrollToIndexFailed={(info) => {
            const offset = getLedgerItemLayout(listRows, info.index).offset;
            listRef.current?.scrollToOffset({ offset, animated: false });
          }}
          refreshControl={
            <RefreshControl
              refreshing={historyQuery.isFetching && !isRecentLoading}
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

      <AccountSelectorSheet
        visible={accountSelectorOpen}
        accounts={accounts}
        selectedAccountId={filters.accountId}
        onClose={() => setAccountSelectorOpen(false)}
        onSelect={onSelectAccount}
      />

      <BottomSheet
        visible={recentRangeOpen}
        title="Recent history"
        onClose={() => setRecentRangeOpen(false)}
      >
        <ScrollView>
          {RECENT_RANGE_OPTIONS.map((opt) => (
            <Pressable
              key={opt}
              onPress={() => {
                setFilters((prev) => ({ ...prev, timeFilter: opt }));
                setRecentRangeOpen(false);
              }}
              style={{
                paddingVertical: 14,
                borderBottomWidth: 1,
                borderBottomColor: theme.colors.border,
              }}
            >
              <Text
                style={{
                  color: filters.timeFilter === opt ? theme.colors.tint : theme.colors.text,
                  ...theme.typography.bodyStrong,
                }}
              >
                Last {TIME_FILTER_LABELS[opt]}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      </BottomSheet>

      <BottomSheet
        visible={upcomingRangeOpen}
        title="Upcoming forecast"
        onClose={() => setUpcomingRangeOpen(false)}
      >
        <ScrollView>
          {OPERATIONAL_FORECAST_DAY_OPTIONS.map((days) => (
            <Pressable
              key={days}
              onPress={() => {
                setForecastDays(days as OperationalForecastDays);
                setUpcomingRangeOpen(false);
              }}
              style={{
                paddingVertical: 14,
                borderBottomWidth: 1,
                borderBottomColor: theme.colors.border,
              }}
            >
              <Text
                style={{
                  color: forecastDays === days ? theme.colors.tint : theme.colors.text,
                  ...theme.typography.bodyStrong,
                }}
              >
                Next {days} days
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      </BottomSheet>

      <TransactionFiltersSheet
        visible={filtersOpen}
        draft={filterDraft}
        onClose={() => setFiltersOpen(false)}
        onApply={(next) => {
          setFilters(next);
          setFiltersOpen(false);
        }}
      />
    </Screen>
  );
}
