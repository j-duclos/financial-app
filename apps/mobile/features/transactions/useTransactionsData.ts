import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { getTimeline, listTransactions } from "@budget-app/api-client";
import { useEffect, useMemo } from "react";
import type { OperationalForecastDays } from "@budget-app/shared";
import {
  DEFAULT_TIME_FILTER,
  ledgerProjectionRange,
  pastTransactionsRange,
  recentRangeLabel,
  upcomingRangeLabel,
} from "@/lib/transactionsLedger";
import { todayStr } from "@/lib/dates";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import {
  buildTransactionListRows,
  currentBalanceFromLedgerData,
  forecastBalanceFromUpcoming,
  indexTimelineBalances,
  partitionTimelineForLedger,
} from "./buildTransactionList";
import { transactionListQueryParams, timelineQueryParams, transactionQueryKeys } from "./queryKeys";
import { needsTimelineProjection } from "./timelineProjection";
import {
  TRANSACTIONS_LEDGER_ORDERING,
  TRANSACTIONS_LEDGER_PAGE_SIZE,
  type TransactionFilters,
} from "./types";
import {
  DEFAULT_LEDGER_HISTORY_STALE_MS,
  DEFAULT_LEDGER_TIMELINE_STALE_MS,
} from "./defaultLedgerPrefetch";

type Options = {
  forecastDays: OperationalForecastDays;
  forecastReady: boolean;
  /** Aligns canonical forecast cache key with Home when present. */
  householdId?: number | null;
};

export function useTransactionsData(filters: TransactionFilters, options: Options) {
  const { forecastDays, forecastReady, householdId = null } = options;
  const debouncedSearch = useDebouncedValue(filters.search, 350);
  const hideReconciledPast = !filters.showReconciled;
  const wantsTimeline = needsTimelineProjection(filters);
  const { start: historyStart, end: historyEnd } = pastTransactionsRange(filters.timeFilter);
  const projectionRange = ledgerProjectionRange(forecastDays);
  const isSearchMode = debouncedSearch.trim().length > 0;
  const needsServerFilteredHistory =
    isSearchMode || filters.categoryId != null;

  const dateAfter = useMemo(() => {
    if (filters.specificDate) return filters.specificDate;
    if (filters.dateFrom) return filters.dateFrom;
    return historyStart;
  }, [filters.specificDate, filters.dateFrom, historyStart]);

  const dateBefore = filters.specificDate ?? filters.dateTo ?? historyEnd;

  const canonicalListParams = transactionListQueryParams({
    accountId: filters.accountId,
    dateAfter: dateAfter ?? historyStart,
    dateBefore,
    showReconciled: filters.showReconciled,
    historyStart,
    ordering: TRANSACTIONS_LEDGER_ORDERING,
    includeRunningBalance: true,
  });

  const displayListParams = transactionListQueryParams({
    accountId: filters.accountId,
    dateAfter: dateAfter ?? historyStart,
    dateBefore,
    showReconciled: filters.showReconciled,
    historyStart,
    categoryId: filters.categoryId,
    search: debouncedSearch,
    ordering: isSearchMode ? "-date,-id" : TRANSACTIONS_LEDGER_ORDERING,
    includeRunningBalance: !isSearchMode,
  });

  const pageSize = TRANSACTIONS_LEDGER_PAGE_SIZE;

  /** Canonical unfiltered history — header source + default list rows (Home prefetch key). */
  const canonicalHistoryQuery = useInfiniteQuery({
    queryKey: transactionQueryKeys.list({ ...canonicalListParams, pageSize }),
    queryFn: ({ pageParam = 1 }) =>
      listTransactions({
        account: filters.accountId ?? undefined,
        date_after: dateAfter,
        date_before: dateBefore,
        page: pageParam,
        page_size: pageSize,
        ordering: TRANSACTIONS_LEDGER_ORDERING,
        include_running_balance: true,
        ...(filters.showReconciled
          ? { show_reconciled: true, include_reconciled_after: historyStart }
          : { reconciled: false }),
      }),
    initialPageParam: 1,
    getNextPageParam: (lastPage, _pages, lastPageParam) =>
      lastPage.next ? lastPageParam + 1 : undefined,
    enabled: filters.accountId != null,
    staleTime: DEFAULT_LEDGER_HISTORY_STALE_MS,
  });

  /** Presentation-only when search or category filter needs full-range server matching. */
  const displayHistoryQuery = useInfiniteQuery({
    queryKey: transactionQueryKeys.listDisplay({ ...displayListParams, pageSize }),
    queryFn: ({ pageParam = 1 }) =>
      listTransactions({
        account: filters.accountId ?? undefined,
        category: filters.categoryId ?? undefined,
        date_after: dateAfter,
        date_before: dateBefore,
        search: debouncedSearch.trim() || undefined,
        page: pageParam,
        page_size: pageSize,
        ordering: isSearchMode ? "-date,-id" : TRANSACTIONS_LEDGER_ORDERING,
        include_running_balance: !isSearchMode,
        ...(filters.showReconciled
          ? { show_reconciled: true, include_reconciled_after: historyStart }
          : { reconciled: false }),
      }),
    initialPageParam: 1,
    getNextPageParam: (lastPage, _pages, lastPageParam) =>
      lastPage.next ? lastPageParam + 1 : undefined,
    enabled: filters.accountId != null && needsServerFilteredHistory,
    staleTime: DEFAULT_LEDGER_HISTORY_STALE_MS,
  });

  const canonicalHistoryTransactions = useMemo(
    () => canonicalHistoryQuery.data?.pages.flatMap((p) => p.results) ?? [],
    [canonicalHistoryQuery.data?.pages]
  );

  const displayHistoryTransactions = useMemo(
    () => displayHistoryQuery.data?.pages.flatMap((p) => p.results) ?? [],
    [displayHistoryQuery.data?.pages]
  );

  /** Drain display query pages so search/category empty states reflect full-range results. */
  useEffect(() => {
    if (
      needsServerFilteredHistory &&
      displayHistoryQuery.hasNextPage &&
      !displayHistoryQuery.isFetchingNextPage
    ) {
      void displayHistoryQuery.fetchNextPage();
    }
  }, [
    needsServerFilteredHistory,
    displayHistoryQuery.hasNextPage,
    displayHistoryQuery.isFetchingNextPage,
    displayHistoryQuery.fetchNextPage,
  ]);

  const historyForList = needsServerFilteredHistory
    ? displayHistoryTransactions
    : canonicalHistoryTransactions;

  const activeHistoryQuery = needsServerFilteredHistory
    ? displayHistoryQuery
    : canonicalHistoryQuery;

  const timelineEnabled =
    forecastReady && wantsTimeline && filters.accountId != null;

  const timelineQuery = useQuery({
    queryKey: transactionQueryKeys.timeline(
      timelineQueryParams({
        start: projectionRange.start,
        end: projectionRange.end,
        accountId: filters.accountId,
        householdId,
        hideReconciledPast,
      })
    ),
    queryFn: () =>
      getTimeline({
        start: projectionRange.start,
        end: projectionRange.end,
        as_of: todayStr(),
        account_id: filters.accountId ?? undefined,
        household_id: householdId ?? undefined,
        exclude_reconciled_past: hideReconciledPast,
      }),
    enabled: timelineEnabled,
    staleTime: DEFAULT_LEDGER_TIMELINE_STALE_MS,
  });

  const balanceMap = useMemo(
    () => indexTimelineBalances(timelineQuery.data?.timeline),
    [timelineQuery.data?.timeline]
  );

  const { pending, upcoming } = useMemo(() => {
    const timeline = timelineQuery.data?.timeline ?? [];
    return partitionTimelineForLedger(timeline, todayStr(), filters.accountId);
  }, [timelineQuery.data?.timeline, filters.accountId]);

  const filtersForList = useMemo((): TransactionFilters => {
    return {
      accountId: filters.accountId,
      categoryId: filters.categoryId,
      timeFilter: filters.timeFilter,
      specificDate: filters.specificDate,
      dateFrom: filters.dateFrom,
      dateTo: filters.dateTo,
      showReconciled: filters.showReconciled,
      flow: filters.flow,
      cleared: filters.cleared,
      forecast: filters.forecast,
      amountMin: filters.amountMin,
      amountMax: filters.amountMax,
      search: debouncedSearch,
    };
  }, [
    filters.accountId,
    filters.categoryId,
    filters.timeFilter,
    filters.specificDate,
    filters.dateFrom,
    filters.dateTo,
    filters.showReconciled,
    filters.flow,
    filters.cleared,
    filters.forecast,
    filters.amountMin,
    filters.amountMax,
    debouncedSearch,
  ]);

  const displayQuerySettled =
    !needsServerFilteredHistory ||
    (!displayHistoryQuery.isPending &&
      !displayHistoryQuery.hasNextPage &&
      !displayHistoryQuery.isFetchingNextPage);

  const timelineLoading = wantsTimeline && timelineQuery.isPending && !timelineQuery.data;
  const recentLoading =
    activeHistoryQuery.isPending && historyForList.length === 0;

  const listRows = useMemo(
    () =>
      buildTransactionListRows({
        upcoming,
        pending,
        history: historyForList,
        balanceMap,
        filters: filtersForList,
        today: todayStr(),
        recentLoading,
        timelineLoading,
        isSearchMode,
        serverFilteredHistory: needsServerFilteredHistory,
        recentRangeLabel: recentRangeLabel(filters.timeFilter),
        upcomingRangeLabel: upcomingRangeLabel(forecastDays),
      }),
    [
      upcoming,
      pending,
      historyForList,
      balanceMap,
      filtersForList,
      recentLoading,
      timelineLoading,
      isSearchMode,
      needsServerFilteredHistory,
      filters.timeFilter,
      forecastDays,
    ]
  );

  const headerCurrentFromLedger = useMemo(
    () =>
      currentBalanceFromLedgerData({
        pending,
        history: canonicalHistoryTransactions,
        today: todayStr(),
        showReconciled: filters.showReconciled,
        historyComplete: !canonicalHistoryQuery.hasNextPage,
      }),
    [
      pending,
      canonicalHistoryTransactions,
      filters.showReconciled,
      canonicalHistoryQuery.hasNextPage,
    ]
  );

  const headerForecastBalance = useMemo(
    () => forecastBalanceFromUpcoming(upcoming),
    [upcoming]
  );

  return {
    listRows,
    historyQuery: activeHistoryQuery,
    canonicalHistoryQuery,
    displayHistoryQuery,
    timelineQuery,
    forecastDays,
    forecastReady,
    defaultTimeFilter: DEFAULT_TIME_FILTER,
    headerForecastBalance,
    headerCurrentFromLedger,
    isSearchMode,
    needsServerFilteredHistory,
    displayQuerySettled,
    isLoading:
      filters.accountId != null &&
      (recentLoading || (wantsTimeline && timelineLoading)) &&
      listRows.length === 0,
    isRecentLoading: recentLoading,
    isTimelineLoading: timelineLoading,
    isError: activeHistoryQuery.isError,
    error: activeHistoryQuery.error,
    isFetchingNextPage: activeHistoryQuery.isFetchingNextPage,
    hasNextPage: activeHistoryQuery.hasNextPage,
    fetchNextPage: activeHistoryQuery.fetchNextPage,
    refetch: async () => {
      await canonicalHistoryQuery.refetch();
      if (needsServerFilteredHistory) await displayHistoryQuery.refetch();
      if (wantsTimeline) await timelineQuery.refetch();
    },
    wantsTimeline,
  };
}
