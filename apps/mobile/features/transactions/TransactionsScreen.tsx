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
import { TransactionSearchSheet } from "./TransactionSearchSheet";
import { AccountSelectorSheet } from "./AccountSelectorSheet";
import { AccountLedgerHeader } from "./AccountLedgerHeader";
import type { TransactionListRow } from "./buildTransactionList";
import {
  estimateLedgerOffset,
  findLedgerBoundaryIndex,
  findLedgerFocusIndex,
  firstSearchParam,
  getLedgerItemLayout,
  ledgerOpenScrollIndex,
  type LedgerFocusParams,
} from "./ledgerScrollAnchor";
import { markAttentionNavigation } from "@/features/dashboard/attentionNavigationTiming";
import {
  parseRouteAccountId,
  rememberTransactionAccountSelection,
  resolveInitialTransactionAccount,
} from "./accountSelection";
import {
  getTransactionRowDestination,
  navigateToTransactionRowDestination,
} from "./transactionRowNavigation";

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
    account?: string | string[];
    accountName?: string | string[];
    category?: string | string[];
    date?: string | string[];
    dateFrom?: string | string[];
    dateTo?: string | string[];
    focus?: string | string[];
    focusDate?: string | string[];
    focusTransactionId?: string | string[];
    focusRuleId?: string | string[];
    focusEventId?: string | string[];
    focusDescription?: string | string[];
  }>();
  const routeAccountId = parseRouteAccountId(firstSearchParam(params.account) || undefined);
  const ledgerFocus = useMemo((): LedgerFocusParams | null => {
    const focusKind = firstSearchParam(params.focus);
    if (focusKind !== "forecast-risk" && focusKind !== "ledger-event") return null;
    const txnRaw = firstSearchParam(params.focusTransactionId);
    const ruleRaw = firstSearchParam(params.focusRuleId);
    const dateRaw = firstSearchParam(params.focusDate);
    const descRaw = firstSearchParam(params.focusDescription);
    const txnId = Number(txnRaw);
    const ruleId = Number(ruleRaw);
    return {
      focus: focusKind,
      focusDate: dateRaw || null,
      focusTransactionId:
        txnRaw !== "" && Number.isInteger(txnId) && txnId > 0 ? txnId : null,
      focusRuleId:
        ruleRaw !== "" && Number.isInteger(ruleId) && ruleId > 0 ? ruleId : null,
      focusDescription: descRaw || null,
    };
  }, [
    params.focus,
    params.focusDate,
    params.focusTransactionId,
    params.focusRuleId,
    params.focusDescription,
  ]);
  const focusMountKey = [
    firstSearchParam(params.focus),
    firstSearchParam(params.focusDate),
    firstSearchParam(params.focusTransactionId),
    firstSearchParam(params.focusRuleId),
    firstSearchParam(params.focusEventId),
    firstSearchParam(params.focusDescription),
  ].join(":");
  const routeFilters = filtersFromSearchParams({
    account: firstSearchParam(params.account) || undefined,
    category: firstSearchParam(params.category) || undefined,
    date: firstSearchParam(params.date) || undefined,
    dateFrom: firstSearchParam(params.dateFrom) || undefined,
    dateTo: firstSearchParam(params.dateTo) || undefined,
  });

  const [filters, setFilters] = useState<TransactionFilters>(() => ({
    ...DEFAULT_TRANSACTION_FILTERS,
    ...routeFilters,
    accountId: routeAccountId,
  }));
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchDraft, setSearchDraft] = useState("");
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
        account: firstSearchParam(params.account) || undefined,
        category: firstSearchParam(params.category) || undefined,
        date: firstSearchParam(params.date) || undefined,
        dateFrom: firstSearchParam(params.dateFrom) || undefined,
        dateTo: firstSearchParam(params.dateTo) || undefined,
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
    wantsTimeline,
  } = useTransactionsData(filters, {
    forecastDays,
    forecastReady,
    householdId: defaultHouseholdId,
  });

  const ledgerListKey = `${filters.accountId ?? "none"}-${filters.timeFilter}-${forecastDays}`;
  const timelineSettled =
    !wantsTimeline || timelineQuery.isFetched || timelineQuery.isError;
  const ledgerDataReady =
    !isRecentLoading &&
    !isTimelineLoading &&
    timelineSettled &&
    !listIsOnlyPlaceholders(listRows) &&
    listHasActivityRows(listRows);
  const hasLedgerDeepLinkFocus = ledgerFocus != null;
  const focusHighlightIndex = useMemo(() => {
    if (!ledgerDataReady || ledgerFocus == null) return null;
    return findLedgerFocusIndex(listRows, ledgerFocus);
  }, [listRows, ledgerDataReady, ledgerFocus]);
  const ledgerBoundaryIndex = useMemo(() => {
    if (!ledgerDataReady) return null;
    return findLedgerBoundaryIndex(listRows);
  }, [ledgerDataReady, listRows]);
  /**
   * Remount when account/data OR deep-link focus changes.
   * Deep-link scrolls must NOT use getItemLayout — estimated heights overshoot (Aug 30 → Sep 4).
   */
  const listMountKey = `${ledgerListKey}:${ledgerDataReady ? "ready" : "loading"}:${focusMountKey}`;
  const ledgerAnchorIndex = useMemo(() => {
    if (!ledgerDataReady) return null;
    if (hasLedgerDeepLinkFocus) {
      if (focusHighlightIndex != null) return focusHighlightIndex;
      // Timeline settled and row still missing — only then fall back to default boundary.
      if (timelineSettled && !isTimelineLoading) {
        return ledgerOpenScrollIndex(listRows, ledgerFocus, {
          allowDefaultWhenFocusMissing: true,
        });
      }
      return null;
    }
    return ledgerOpenScrollIndex(listRows, null);
  }, [
    listRows,
    ledgerDataReady,
    hasLedgerDeepLinkFocus,
    focusHighlightIndex,
    timelineSettled,
    isTimelineLoading,
    ledgerFocus,
  ]);
  const ledgerListReady =
    ledgerDataReady &&
    (hasLedgerDeepLinkFocus
      ? focusHighlightIndex != null || (timelineSettled && !isTimelineLoading)
      : ledgerBoundaryIndex == null || ledgerAnchorIndex != null);
  const anchorScrollIndex = useMemo(() => {
    if (!ledgerListReady || ledgerAnchorIndex == null) return 0;
    return Math.max(0, Math.min(ledgerAnchorIndex, Math.max(0, listRows.length - 1)));
  }, [ledgerListReady, ledgerAnchorIndex, listRows.length]);
  const anchorAppliedRef = useRef<string | null>(null);
  const focusScrollKey =
    hasLedgerDeepLinkFocus && focusHighlightIndex != null
      ? `${listMountKey}:focus-${focusHighlightIndex}`
      : listMountKey;

  const [focusHighlightActive, setFocusHighlightActive] = useState(false);
  useEffect(() => {
    if (focusHighlightIndex == null || focusHighlightIndex < 0) {
      setFocusHighlightActive(false);
      return;
    }
    setFocusHighlightActive(true);
    const timer = setTimeout(() => setFocusHighlightActive(false), 2400);
    return () => clearTimeout(timer);
  }, [focusScrollKey, focusHighlightIndex]);

  const applyLedgerAnchorScroll = useCallback(() => {
    if (anchorScrollIndex <= 0) return;
    if (hasLedgerDeepLinkFocus) {
      // No getItemLayout on focus lists — scrollToIndex measures real rows.
      listRef.current?.scrollToIndex({
        index: anchorScrollIndex,
        animated: false,
        viewPosition: 0,
      });
      return;
    }
    const offset = estimateLedgerOffset(listRows, anchorScrollIndex);
    listRef.current?.scrollToOffset({ offset, animated: false });
  }, [anchorScrollIndex, listRows, hasLedgerDeepLinkFocus]);

  useEffect(() => {
    anchorAppliedRef.current = null;
  }, [focusScrollKey]);

  useEffect(() => {
    if (!ledgerListReady || anchorScrollIndex <= 0) return;
    applyLedgerAnchorScroll();
    const t1 = setTimeout(() => applyLedgerAnchorScroll(), 50);
    const t2 = setTimeout(() => applyLedgerAnchorScroll(), 200);
    const t3 = setTimeout(() => applyLedgerAnchorScroll(), 500);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
    };
  }, [focusScrollKey, ledgerListReady, anchorScrollIndex, applyLedgerAnchorScroll]);

  const getItemLayout = useCallback(
    (_data: ArrayLike<TransactionListRow> | null | undefined, index: number) =>
      getLedgerItemLayout(listRows, index),
    [listRows]
  );

  const onLedgerContentSizeChange = useCallback(() => {
    if (!ledgerListReady || anchorScrollIndex <= 0) return;
    if (anchorAppliedRef.current === focusScrollKey) return;
    anchorAppliedRef.current = focusScrollKey;
    applyLedgerAnchorScroll();
  }, [ledgerListReady, anchorScrollIndex, focusScrollKey, applyLedgerAnchorScroll]);

  const activeFilterCount = countActiveTransactionFilters(filters);
  const selectedAccountName =
    selectedAccount != null
      ? getEffectiveDisplayName(selectedAccount)
      : firstSearchParam(params.accountName) || "Account";

  const onEndReached = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const onPressRow = useCallback(
    (item: TransactionListRow) => {
      const destination = getTransactionRowDestination(item);
      if (destination == null) return;
      navigateToTransactionRowDestination(router, destination);
    },
    [router]
  );

  const renderItem = useCallback(
    ({ item, index }: { item: TransactionListRow; index: number }) => (
      <TransactionListItem
        item={item}
        onPressRow={onPressRow}
        onPressRecentRange={() => setRecentRangeOpen(true)}
        onPressUpcomingRange={() => setUpcomingRangeOpen(true)}
        focusHighlight={focusHighlightActive && index === focusHighlightIndex}
      />
    ),
    [onPressRow, focusHighlightActive, focusHighlightIndex]
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
        const historyCache =
          historyQuery.data != null && historyQuery.fetchStatus === "idle"
            ? "HIT"
            : historyQuery.isFetching
              ? "FETCH"
              : "MISS";
        const timelineCache =
          timelineQuery.data != null && timelineQuery.fetchStatus === "idle"
            ? "HIT"
            : timelineQuery.isFetching
              ? "FETCH"
              : "MISS";
        console.debug(
          `[PERF] transactions first_rows_visible count=${activityCount} ` +
            `history_cache=${historyCache} timeline_cache=${timelineCache} ` +
            `timeline_status=${timelineQuery.fetchStatus} timeline_fetched=${timelineQuery.isFetched}`
        );
      }
    }
  }, [
    hasActivity,
    listRows,
    historyQuery.data,
    historyQuery.fetchStatus,
    historyQuery.isFetching,
    timelineQuery.data,
    timelineQuery.fetchStatus,
    timelineQuery.isFetched,
    timelineQuery.isFetching,
  ]);

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
              color={filters.search.trim() ? theme.colors.tint : undefined}
              onPress={() => {
                setSearchDraft(filters.search);
                setSearchOpen(true);
              }}
            />
            <View>
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
              {activeFilterCount > 0 ? (
                <View
                  pointerEvents="none"
                  style={{
                    position: "absolute",
                    top: 6,
                    right: 6,
                    width: 8,
                    height: 8,
                    borderRadius: 4,
                    backgroundColor: theme.colors.tint,
                  }}
                />
              ) : null}
            </View>
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
      ) : !ledgerListReady ? (
        <View style={{ padding: theme.spacing.lg, gap: 8 }}>
          <SkeletonBlock lines={3} />
          <SkeletonBlock lines={3} />
        </View>
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
            // Render enough rows that the focus target exists before scrollToIndex.
            hasLedgerDeepLinkFocus ? anchorScrollIndex + 12 : anchorScrollIndex + 8
          )}
          // Deep links: never use estimated layouts — they overshoot (Aug 30 → Sep 4).
          initialScrollIndex={
            !hasLedgerDeepLinkFocus && anchorScrollIndex > 0 ? anchorScrollIndex : undefined
          }
          getItemLayout={hasLedgerDeepLinkFocus ? undefined : getItemLayout}
          onContentSizeChange={onLedgerContentSizeChange}
          onScrollToIndexFailed={(info) => {
            // Undershoot on failure — overshooting is what put Aug 30 taps on Sep 4.
            const unit = info.averageItemLength > 0 ? info.averageItemLength : 72;
            const approx = Math.max(0, unit * info.index * 0.65);
            listRef.current?.scrollToOffset({ offset: approx, animated: false });
            setTimeout(() => {
              listRef.current?.scrollToIndex({
                index: info.index,
                animated: false,
                viewPosition: 0,
              });
            }, 100);
            setTimeout(() => {
              listRef.current?.scrollToIndex({
                index: info.index,
                animated: false,
                viewPosition: 0,
              });
            }, 350);
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

      <TransactionSearchSheet
        visible={searchOpen}
        value={searchDraft}
        onChange={setSearchDraft}
        onClose={() => {
          setFilters((prev) => ({ ...prev, search: searchDraft.trim() }));
          setSearchOpen(false);
        }}
        onClear={() => {
          setSearchDraft("");
          setFilters((prev) => ({ ...prev, search: "" }));
          setSearchOpen(false);
        }}
      />
    </Screen>
  );
}
