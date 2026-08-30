import type { QueryClient } from "@tanstack/react-query";
import { getAccount } from "@budget-app/api-client";
import type { PaginatedResponse } from "@budget-app/api-client";
import type { Account, OperationalForecastDays } from "@budget-app/shared";
import { accountQueryKeys } from "./queryKeys";
import { seedAccountFromListCache } from "./accountDetailSeed";

export const BALANCE_DETAIL_STALE_MS = 30_000;
export const FORECAST_DETAIL_STALE_MS = 60_000;

export type BalanceDetailInitialData = {
  data: Account | undefined;
  updatedAt: number | undefined;
};

function findInResults(
  data: PaginatedResponse<Account> | undefined,
  accountId: number
): Account | undefined {
  return data?.results?.find((a) => a.id === accountId);
}

function accountHasBalanceFields(account: Account): boolean {
  return account.balance != null || account.available_balance != null || account.balance_owed != null;
}

export function forecastDetailQueryKey(
  accountId: number,
  forecastDays: OperationalForecastDays
) {
  return ["account", accountId, "forecast", forecastDays] as const;
}

/**
 * React Query-native Detail initialization: read list/detail caches without side effects.
 * `updatedAt` comes from the source query's actual `dataUpdatedAt` — never `Date.now()`.
 */
export function resolveBalanceDetailInitialData(
  queryClient: QueryClient,
  accountId: number,
  forecastDays: OperationalForecastDays
): BalanceDetailInitialData {
  const detailState = queryClient.getQueryState<Account>(accountQueryKeys.balanceDetail(accountId));
  if (detailState?.data && accountHasBalanceFields(detailState.data)) {
    return {
      data: detailState.data,
      updatedAt: detailState.dataUpdatedAt,
    };
  }

  const enrichedListState = queryClient.getQueryState<PaginatedResponse<Account>>(
    accountQueryKeys.enrichedList(forecastDays)
  );
  const enriched = findInResults(enrichedListState?.data, accountId);
  if (enriched && accountHasBalanceFields(enriched)) {
    return {
      data: enriched,
      updatedAt: enrichedListState?.dataUpdatedAt,
    };
  }

  const mainListState = queryClient.getQueryState<PaginatedResponse<Account>>(
    accountQueryKeys.mainList()
  );
  const main = findInResults(mainListState?.data, accountId);
  if (main && accountHasBalanceFields(main)) {
    return {
      data: main,
      updatedAt: mainListState?.dataUpdatedAt,
    };
  }

  const seeded = seedAccountFromListCache(queryClient, accountId, forecastDays);
  if (seeded && accountHasBalanceFields(seeded)) {
    return { data: seeded, updatedAt: undefined };
  }

  return { data: undefined, updatedAt: undefined };
}

export function mergeAccountIntoEnrichedListCache(
  queryClient: QueryClient,
  forecastDays: OperationalForecastDays,
  account: Account
): void {
  const key = accountQueryKeys.enrichedList(forecastDays);
  const existing = queryClient.getQueryData<PaginatedResponse<Account>>(key);
  if (!existing?.results) {
    queryClient.setQueryData(key, {
      count: 1,
      next: null,
      previous: null,
      results: [account],
    } satisfies PaginatedResponse<Account>);
    return;
  }
  const idx = existing.results.findIndex((a) => a.id === account.id);
  const results =
    idx >= 0
      ? existing.results.map((a, i) => (i === idx ? { ...a, ...account } : a))
      : [...existing.results, account];
  queryClient.setQueryData(key, { ...existing, results, count: results.length });
}

export function applyEnrichedAccountDetailToCache(
  queryClient: QueryClient,
  accountId: number,
  forecastDays: OperationalForecastDays,
  account: Account
): void {
  queryClient.setQueryData(accountQueryKeys.balanceDetail(accountId), account);
  queryClient.setQueryData(forecastDetailQueryKey(accountId, forecastDays), account);
  mergeAccountIntoEnrichedListCache(queryClient, forecastDays, account);
}

/** Single-account enriched retrieve — balance + forecast_summary + health. */
export async function fetchEnrichedAccountDetail(
  queryClient: QueryClient,
  accountId: number,
  forecastDays: OperationalForecastDays
): Promise<Account> {
  const account = await getAccount(accountId, true, {
    forecast_summary: true,
    health: true,
    days: forecastDays,
  });
  applyEnrichedAccountDetailToCache(queryClient, accountId, forecastDays, account);
  return account;
}

export async function refreshAccountDetailResources(input: {
  queryClient: QueryClient;
  accountId: number;
  forecastDays: OperationalForecastDays;
  forecastReady: boolean;
  refetchRecent: () => Promise<unknown>;
  refetchUpcoming: () => Promise<unknown>;
  refetchBalanceOnly: () => Promise<unknown>;
}): Promise<void> {
  const accountTask = input.forecastReady
    ? fetchEnrichedAccountDetail(input.queryClient, input.accountId, input.forecastDays)
    : input.refetchBalanceOnly();

  await Promise.all([accountTask, input.refetchRecent(), input.refetchUpcoming()]);
}
