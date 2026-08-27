import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { getReconcileSetup, getTimeline, listTransactions } from "@budget-app/api-client";
import { useMemo } from "react";
import {
  DEFAULT_TIME_FILTER,
  ledgerPastTransactionStart,
  ledgerProjectionRange,
  pastTransactionsRange,
} from "@/lib/transactionsLedger";
import { todayStr } from "@/lib/dates";
import { usePageForecastWindow } from "@/hooks/usePageForecastWindow";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import {
  buildTransactionListRows,
  indexTimelineBalances,
} from "./buildTransactionList";
import { transactionListQueryParams, timelineQueryParams, transactionQueryKeys } from "./queryKeys";
import { needsTimelineProjection } from "./timelineProjection";
import type { TransactionFilters } from "./types";

const PAGE_SIZE = 50;

export function useTransactionsData(filters: TransactionFilters) {
  const { forecastDays, ready: forecastReady } = usePageForecastWindow();
  const debouncedSearch = useDebouncedValue(filters.search, 350);
  const hideReconciledPast = !filters.showReconciled;
  const wantsTimeline = needsTimelineProjection(filters);
  const { start: historyStart, end: historyEnd } = pastTransactionsRange(filters.timeFilter);
  const projectionRange = ledgerProjectionRange(forecastDays);

  const reconcileSetupQuery = useQuery({
    queryKey: transactionQueryKeys.reconcileSetup(filters.accountId ?? 0),
    queryFn: () => getReconcileSetup(filters.accountId as number),
    enabled: filters.accountId != null,
    staleTime: 120_000,
  });

  const dateAfter = useMemo(() => {
    if (filters.specificDate) return filters.specificDate;
    if (filters.dateFrom) return filters.dateFrom;
    return ledgerPastTransactionStart(filters.timeFilter, hideReconciledPast, {
      min_start_date: reconcileSetupQuery.data?.min_start_date,
      last_reconcile_period_end: reconcileSetupQuery.data?.last_reconcile_period_end,
    });
  }, [
    filters.specificDate,
    filters.dateFrom,
    filters.timeFilter,
    hideReconciledPast,
    reconcileSetupQuery.data?.min_start_date,
    reconcileSetupQuery.data?.last_reconcile_period_end,
  ]);

  const dateBefore = filters.specificDate ?? filters.dateTo ?? historyEnd;

  const listParams = transactionListQueryParams({
    accountId: filters.accountId,
    categoryId: filters.categoryId,
    dateAfter,
    dateBefore,
    showReconciled: filters.showReconciled,
    historyStart,
    search: debouncedSearch,
  });

  const historyQuery = useInfiniteQuery({
    queryKey: transactionQueryKeys.list({ ...listParams, pageSize: PAGE_SIZE }),
    queryFn: ({ pageParam = 1 }) =>
      listTransactions({
        account: filters.accountId ?? undefined,
        category: filters.categoryId ?? undefined,
        date_after: dateAfter,
        date_before: dateBefore,
        search: debouncedSearch.trim() || undefined,
        page: pageParam,
        page_size: PAGE_SIZE,
        ...(filters.showReconciled
          ? {
              show_reconciled: true,
              include_reconciled_after: historyStart,
            }
          : { reconciled: false }),
      }),
    initialPageParam: 1,
    getNextPageParam: (lastPage, _pages, lastPageParam) =>
      lastPage.next ? lastPageParam + 1 : undefined,
    enabled: forecastReady,
    staleTime: 30_000,
  });

  const timelineQuery = useQuery({
    queryKey: transactionQueryKeys.timeline(
      timelineQueryParams({
        start: projectionRange.start,
        end: projectionRange.end,
        accountId: filters.accountId,
        hideReconciledPast,
      })
    ),
    queryFn: () =>
      getTimeline({
        start: projectionRange.start,
        end: projectionRange.end,
        as_of: todayStr(),
        account_id: filters.accountId ?? undefined,
        exclude_reconciled_past: hideReconciledPast,
      }),
    enabled: forecastReady && wantsTimeline,
    staleTime: 60_000,
  });

  const historyTransactions = useMemo(
    () => historyQuery.data?.pages.flatMap((p) => p.results) ?? [],
    [historyQuery.data?.pages]
  );

  const balanceMap = useMemo(
    () => indexTimelineBalances(timelineQuery.data?.timeline),
    [timelineQuery.data?.timeline]
  );

  const upcomingRows = useMemo(() => {
    const timeline = timelineQuery.data?.timeline ?? [];
    const today = todayStr();
    return timeline.filter((row) => row.date > today);
  }, [timelineQuery.data?.timeline]);

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

  const listRows = useMemo(
    () =>
      buildTransactionListRows({
        upcoming: upcomingRows,
        history: historyTransactions,
        balanceMap,
        filters: filtersForList,
        today: todayStr(),
      }),
    [upcomingRows, historyTransactions, balanceMap, filtersForList]
  );

  return {
    listRows,
    historyQuery,
    timelineQuery,
    reconcileSetupQuery,
    forecastDays,
    forecastReady,
    defaultTimeFilter: DEFAULT_TIME_FILTER,
    isLoading: historyQuery.isPending && listRows.length === 0,
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
