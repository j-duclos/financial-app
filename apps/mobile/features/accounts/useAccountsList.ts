import { useMemo, useRef } from "react";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { listAccounts, listPlaidItems } from "@budget-app/api-client";
import { timedStartupQueryFn } from "@/lib/startupQueries";
import type { Account } from "@budget-app/shared";
import type { OperationalForecastDays } from "@budget-app/shared";
import { accountsListEnrichmentEnabled } from "@budget-app/shared";
import { accountQueryKeys } from "./queryKeys";

const MAIN_LIST_STALE_MS = 30_000;
const ENRICHED_LIST_STALE_MS = 60_000;

function mergeEnrichedAccounts(base: Account[], enriched: Account[] | undefined): Account[] {
  if (!enriched?.length) return base;
  if (!base.length) return enriched;
  const byId = new Map(enriched.map((account) => [account.id, account]));
  const merged = base.map((account) => byId.get(account.id) ?? account);
  const seen = new Set(base.map((account) => account.id));
  for (const extra of enriched) {
    if (!seen.has(extra.id)) merged.push(extra);
  }
  return merged;
}

function withPlaidItemIds(
  accounts: Account[],
  items: { id: number; linked_accounts?: { account_id: number }[] }[] | undefined
): Account[] {
  if (!items?.length) return accounts;
  const byAccount = new Map<number, number>();
  for (const item of items) {
    for (const row of item.linked_accounts ?? []) {
      if (row.account_id) byAccount.set(row.account_id, item.id);
    }
  }
  if (byAccount.size === 0) return accounts;
  return accounts.map((account) => {
    if (account.plaid_item_id != null) return account;
    const itemId = byAccount.get(account.id);
    return itemId != null ? { ...account, plaid_item_id: itemId } : account;
  });
}

export function useAccountsList(
  forecastDays: OperationalForecastDays,
  options?: { forecastReady?: boolean }
) {
  const forecastReady = options?.forecastReady ?? true;
  const queryClient = useQueryClient();
  const lastNonEmpty = useRef<Account[]>([]);

  const mainQuery = useQuery({
    queryKey: accountQueryKeys.mainList(),
    queryFn: () =>
      timedStartupQueryFn("accounts", "network_fetch", () =>
        listAccounts({ balance: "true", page_size: 500, active_only: true })
      ),
    placeholderData: keepPreviousData,
    staleTime: MAIN_LIST_STALE_MS,
  });

  const enrichedListKey = accountQueryKeys.enrichedList(forecastDays);
  const enrichedCacheUpdatedAt = queryClient.getQueryState(enrichedListKey)?.dataUpdatedAt;

  const enrichEnabled = accountsListEnrichmentEnabled({
    forecastReady,
    mainListSuccess: mainQuery.isSuccess,
    enrichedListUpdatedAt: enrichedCacheUpdatedAt,
    enrichedStaleTimeMs: ENRICHED_LIST_STALE_MS,
  });

  const enrichQuery = useQuery({
    queryKey: enrichedListKey,
    queryFn: () =>
      listAccounts({
        balance: "true",
        forecast_summary: "true",
        health: "true",
        days: forecastDays,
        page_size: 500,
        active_only: true,
      }),
    enabled: enrichEnabled,
    placeholderData: keepPreviousData,
    staleTime: ENRICHED_LIST_STALE_MS,
  });

  const plaidQuery = useQuery({
    queryKey: ["plaid-items", "mobile-link-status"],
    queryFn: () => listPlaidItems({ page_size: 100 }),
    staleTime: 60_000,
    retry: false,
  });

  const accounts = useMemo(() => {
    const main = mainQuery.data?.results ?? lastNonEmpty.current;
    const enriched = enrichQuery.isSuccess ? enrichQuery.data?.results : undefined;
    const next = withPlaidItemIds(
      mergeEnrichedAccounts(main, enriched),
      plaidQuery.data?.results
    );
    if (next.length > 0) lastNonEmpty.current = next;
    return next;
  }, [mainQuery.data, enrichQuery.data, enrichQuery.isSuccess, plaidQuery.data]);

  const refetch = async () => {
    const mainResult = await mainQuery.refetch();
    if (forecastReady && mainResult.isSuccess) {
      await enrichQuery.refetch();
    }
    await plaidQuery.refetch();
  };

  return {
    accounts,
    isLoading: mainQuery.isPending && accounts.length === 0,
    isEnriching: enrichQuery.isFetching && accounts.length > 0,
    isError: accounts.length === 0 && mainQuery.isError,
    error: mainQuery.error,
    refetch,
  };
}
