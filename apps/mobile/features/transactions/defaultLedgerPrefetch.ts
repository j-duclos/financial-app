import type { QueryClient } from "@tanstack/react-query";
import type { OperationalForecastDays } from "@budget-app/shared";
import { getTimeline, listTransactions } from "@budget-app/api-client";
import {
  ledgerProjectionRange,
  pastTransactionsRange,
} from "@/lib/transactionsLedger";
import { todayStr } from "@/lib/dates";
import {
  timelineQueryParams,
  transactionListQueryParams,
  transactionQueryKeys,
} from "./queryKeys";
import {
  DEFAULT_TRANSACTION_FILTERS,
  TRANSACTIONS_LEDGER_ORDERING,
  TRANSACTIONS_LEDGER_PAGE_SIZE,
} from "./types";

/** Matches `useTransactionsData` history `staleTime`. */
export const DEFAULT_LEDGER_HISTORY_STALE_MS = 30_000;

/** Matches `useTransactionsData` timeline `staleTime`. */
export const DEFAULT_LEDGER_TIMELINE_STALE_MS = 60_000;

export type DefaultLedgerPrefetchInput = {
  accountId: number;
  forecastDays: OperationalForecastDays;
  householdId?: number | null;
};

/**
 * Query options for the default Transactions ledger Recent (history) infinite query.
 * Must stay byte-compatible with `useTransactionsData` under DEFAULT_TRANSACTION_FILTERS.
 */
export function defaultLedgerHistoryQueryOptions(accountId: number) {
  const filters = { ...DEFAULT_TRANSACTION_FILTERS, accountId };
  const { start: historyStart, end: historyEnd } = pastTransactionsRange(filters.timeFilter);
  const dateAfter = historyStart;
  const dateBefore = historyEnd;
  const pageSize = TRANSACTIONS_LEDGER_PAGE_SIZE;

  const listParams = transactionListQueryParams({
    accountId: filters.accountId,
    categoryId: filters.categoryId,
    dateAfter,
    dateBefore,
    showReconciled: filters.showReconciled,
    historyStart,
    search: filters.search,
    ordering: TRANSACTIONS_LEDGER_ORDERING,
    includeRunningBalance: true,
  });

  const queryKey = transactionQueryKeys.list({ ...listParams, pageSize });

  return {
    queryKey,
    staleTime: DEFAULT_LEDGER_HISTORY_STALE_MS,
    initialPageParam: 1 as const,
    queryFn: ({ pageParam = 1 }: { pageParam?: number }) =>
      listTransactions({
        account: accountId,
        category: filters.categoryId ?? undefined,
        date_after: dateAfter,
        date_before: dateBefore,
        search: filters.search.trim() || undefined,
        page: pageParam,
        page_size: pageSize,
        ordering: TRANSACTIONS_LEDGER_ORDERING,
        include_running_balance: true,
        ...(filters.showReconciled
          ? { show_reconciled: true, include_reconciled_after: historyStart }
          : { reconciled: false }),
      }),
    getNextPageParam: (
      lastPage: { next?: string | null },
      _pages: unknown,
      lastPageParam: number
    ) => (lastPage.next ? lastPageParam + 1 : undefined),
  };
}

/**
 * Query options for the default Transactions Pending/Upcoming timeline query.
 * Must stay byte-compatible with `useTransactionsData` under default filters.
 */
export function defaultLedgerTimelineQueryOptions(input: DefaultLedgerPrefetchInput) {
  const { accountId, forecastDays, householdId = null } = input;
  const filters = { ...DEFAULT_TRANSACTION_FILTERS, accountId };
  const hideReconciledPast = !filters.showReconciled;
  const projectionRange = ledgerProjectionRange(forecastDays);

  const queryKey = transactionQueryKeys.timeline(
    timelineQueryParams({
      start: projectionRange.start,
      end: projectionRange.end,
      accountId,
      householdId,
      hideReconciledPast,
    })
  );

  return {
    queryKey,
    staleTime: DEFAULT_LEDGER_TIMELINE_STALE_MS,
    queryFn: () =>
      getTimeline({
        start: projectionRange.start,
        end: projectionRange.end,
        as_of: todayStr(),
        account_id: accountId,
        household_id: householdId ?? undefined,
        exclude_reconciled_past: hideReconciledPast,
      }),
  };
}

function queryIsFreshOrFetching(
  queryClient: QueryClient,
  queryKey: readonly unknown[],
  staleTime: number
): boolean {
  const state = queryClient.getQueryState(queryKey);
  if (!state) return false;
  if (state.fetchStatus === "fetching") return true;
  if (state.data === undefined) return false;
  const updatedAt = state.dataUpdatedAt ?? 0;
  return Date.now() - updatedAt < staleTime;
}

export type PrefetchDefaultLedgerResult = {
  accountId: number;
  recentMs: number | null;
  timelineMs: number | null;
  recentSkipped: boolean;
  timelineSkipped: boolean;
};

/**
 * Prefetch the exact Recent + timeline queries Transactions mounts with for
 * the default ledger state. Skips when the cache is already fresh or a fetch
 * for the same key is in flight (React Query also dedupes).
 */
export async function prefetchDefaultLedgerQueries(
  queryClient: QueryClient,
  input: DefaultLedgerPrefetchInput
): Promise<PrefetchDefaultLedgerResult> {
  const history = defaultLedgerHistoryQueryOptions(input.accountId);
  const timeline = defaultLedgerTimelineQueryOptions(input);

  const recentSkipped = queryIsFreshOrFetching(
    queryClient,
    history.queryKey,
    history.staleTime
  );
  const timelineSkipped = queryIsFreshOrFetching(
    queryClient,
    timeline.queryKey,
    timeline.staleTime
  );

  let recentMs: number | null = null;
  let timelineMs: number | null = null;

  const recentPromise = recentSkipped
    ? Promise.resolve()
    : (async () => {
        const t0 =
          typeof performance !== "undefined" ? performance.now() : Date.now();
        await queryClient.prefetchInfiniteQuery(history);
        recentMs = Math.round(
          (typeof performance !== "undefined" ? performance.now() : Date.now()) - t0
        );
      })();

  const timelinePromise = timelineSkipped
    ? Promise.resolve()
    : (async () => {
        const t0 =
          typeof performance !== "undefined" ? performance.now() : Date.now();
        await queryClient.prefetchQuery(timeline);
        timelineMs = Math.round(
          (typeof performance !== "undefined" ? performance.now() : Date.now()) - t0
        );
      })();

  await Promise.all([
    recentPromise.catch(() => undefined),
    timelinePromise.catch(() => undefined),
  ]);

  return {
    accountId: input.accountId,
    recentMs,
    timelineMs,
    recentSkipped,
    timelineSkipped,
  };
}
