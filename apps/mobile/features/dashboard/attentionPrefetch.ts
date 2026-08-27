import type { QueryClient } from "@tanstack/react-query";
import type { DashboardAttentionItem } from "@budget-app/shared";
import { listTransactions } from "@budget-app/api-client";
import { pastTransactionsRange } from "@/lib/transactionsLedger";
import { transactionListQueryParams, transactionQueryKeys } from "@/features/transactions/queryKeys";
import {
  DEFAULT_TRANSACTION_FILTERS,
  TRANSACTIONS_LEDGER_ORDERING,
  TRANSACTIONS_LEDGER_PAGE_SIZE,
} from "@/features/transactions/types";
import { attentionCardOpensLedger } from "./navigation";

const PREFETCH_PAGE_SIZE = TRANSACTIONS_LEDGER_PAGE_SIZE;

function prefetchCashAccountTransactions(
  queryClient: QueryClient,
  accountId: number
): Promise<void> {
  const filters = { ...DEFAULT_TRANSACTION_FILTERS, accountId };
  const { start: historyStart, end: historyEnd } = pastTransactionsRange(filters.timeFilter);
  const dateBefore = historyEnd;

  const listParams = transactionListQueryParams({
    accountId: filters.accountId,
    categoryId: filters.categoryId,
    dateAfter: historyStart,
    dateBefore,
    showReconciled: true,
    historyStart,
    search: filters.search,
    ordering: TRANSACTIONS_LEDGER_ORDERING,
    includeRunningBalance: true,
  });

  return queryClient
    .prefetchInfiniteQuery({
      queryKey: transactionQueryKeys.list({ ...listParams, pageSize: PREFETCH_PAGE_SIZE }),
      queryFn: ({ pageParam = 1 }) =>
        listTransactions({
          account: accountId,
          date_before: dateBefore,
          page: pageParam,
          page_size: PREFETCH_PAGE_SIZE,
          ordering: TRANSACTIONS_LEDGER_ORDERING,
          include_running_balance: true,
          show_reconciled: true,
          include_reconciled_after: historyStart,
        }),
      initialPageParam: 1,
    })
    .catch(() => undefined);
}

/**
 * Low-priority prefetch for visible cash Attention cards only.
 * Credit account details are not prefetched — navigation is immediate and the
 * destination loads progressively.
 */
export function prefetchVisibleAttentionDestinations(
  queryClient: QueryClient,
  items: DashboardAttentionItem[]
): void {
  for (const item of items) {
    if (attentionCardOpensLedger(item)) {
      void prefetchCashAccountTransactions(queryClient, item.account_id);
    }
  }
}
