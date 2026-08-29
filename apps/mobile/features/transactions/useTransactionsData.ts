import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { getTimeline, listTransactions } from "@budget-app/api-client";
import { useMemo } from "react";
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

  /**
   * Recent "Last N days" uses date_after = historyStart.
   * show_reconciled ON → reconciled rows inside the window plus unreconciled.
   * show_reconciled OFF → reconciled=false within the same date window (web parity).
   */
  const dateAfter = useMemo(() => {
    if (filters.specificDate) return filters.specificDate;
    if (filters.dateFrom) return filters.dateFrom;
    return historyStart;
  }, [filters.specificDate, filters.dateFrom, historyStart]);

  const dateBefore = filters.specificDate ?? filters.dateTo ?? historyEnd;

  const listParams = transactionListQueryParams({
    accountId: filters.accountId,
    categoryId: filters.categoryId,
    dateAfter: dateAfter ?? historyStart,
    dateBefore,
    showReconciled: filters.showReconciled,
    historyStart,
    search: debouncedSearch,
    ordering: isSearchMode ? "-date,-id" : TRANSACTIONS_LEDGER_ORDERING,
    includeRunningBalance: !isSearchMode,
  });

  const pageSize = TRANSACTIONS_LEDGER_PAGE_SIZE;

  // Recent history — ascending ledger order with canonical running balances.
  const historyQuery = useInfiniteQuery({
    queryKey: transactionQueryKeys.list({ ...listParams, pageSize }),
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
    enabled: filters.accountId != null,
    staleTime: DEFAULT_LEDGER_HISTORY_STALE_MS,
  });

  const historyTransactions = useMemo(
    () => historyQuery.data?.pages.flatMap((p) => p.results) ?? [],
    [historyQuery.data?.pages]
  );

  const historySettled = historyQuery.isFetched || historyQuery.isError;
  const timelineEnabled =
    forecastReady && wantsTimeline && filters.accountId != null && historySettled;

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

  const timelineLoading = wantsTimeline && timelineQuery.isPending && !timelineQuery.data;
  const recentLoading = historyQuery.isPending && historyTransactions.length === 0;

  const listRows = useMemo(
    () =>
      buildTransactionListRows({
        upcoming,
        pending,
        history: historyTransactions,
        balanceMap,
        filters: filtersForList,
        today: todayStr(),
        recentLoading,
        timelineLoading,
        isSearchMode,
        recentRangeLabel: recentRangeLabel(filters.timeFilter),
        upcomingRangeLabel: upcomingRangeLabel(forecastDays),
      }),
    [
      upcoming,
      pending,
      historyTransactions,
      balanceMap,
      filtersForList,
      recentLoading,
      timelineLoading,
      isSearchMode,
      filters.timeFilter,
      forecastDays,
    ]
  );

  const headerCurrentFromLedger = useMemo(() => {
    for (let i = listRows.length - 1; i >= 0; i--) {
      const row = listRows[i];
      if (row.kind === "pending" && row.runningBalance != null) return row.runningBalance;
    }
    for (let i = listRows.length - 1; i >= 0; i--) {
      const row = listRows[i];
      if (row.kind === "history" && row.runningBalance != null) return row.runningBalance;
    }
    return null;
  }, [listRows]);

  const headerForecastBalance = useMemo(() => {
    for (let i = listRows.length - 1; i >= 0; i--) {
      const row = listRows[i];
      if (row.kind === "upcoming" && row.runningBalance != null) return row.runningBalance;
    }
    return null;
  }, [listRows]);

  return {
    listRows,
    historyQuery,
    timelineQuery,
    forecastDays,
    forecastReady,
    defaultTimeFilter: DEFAULT_TIME_FILTER,
    headerForecastBalance,
    headerCurrentFromLedger,
    isSearchMode,
    isLoading:
      filters.accountId != null &&
      recentLoading &&
      !timelineLoading &&
      listRows.length === 0,
    isRecentLoading: recentLoading,
    isTimelineLoading: timelineLoading,
    isError: historyQuery.isError,
    error: historyQuery.error,
    isFetchingNextPage: historyQuery.isFetchingNextPage,
    hasNextPage: historyQuery.hasNextPage,
    fetchNextPage: historyQuery.fetchNextPage,
    refetch: async () => {
      await historyQuery.refetch();
      if (wantsTimeline) await timelineQuery.refetch();
    },
    wantsTimeline,
  };
}
