import type { QueryClient } from "@tanstack/react-query";
import type { Account, OperationalForecastDays } from "@budget-app/shared";
import type { PaginatedResponse } from "@budget-app/api-client";
import { accountQueryKeys } from "./queryKeys";

function findInResults(
  data: PaginatedResponse<Account> | Account[] | undefined,
  accountId: number
): Account | undefined {
  if (!data) return undefined;
  const results = Array.isArray(data) ? data : data.results;
  return results?.find((a) => a.id === accountId);
}

/**
 * Seed Account Detail from Accounts list caches so navigation can render
 * name/balance immediately without waiting for a detail retrieve.
 */
export function seedAccountFromListCache(
  queryClient: QueryClient,
  accountId: number,
  forecastDays: OperationalForecastDays
): Account | undefined {
  const enriched = findInResults(
    queryClient.getQueryData(accountQueryKeys.enrichedList(forecastDays)),
    accountId
  );
  if (enriched) return enriched;

  const main = findInResults(queryClient.getQueryData(accountQueryKeys.mainList()), accountId);
  if (main) return main;

  return queryClient.getQueryData(accountQueryKeys.balanceDetail(accountId));
}

export function accountHasForecastEnrichment(account: Account | undefined): boolean {
  if (!account) return false;
  return (
    account.available_to_spend != null ||
    account.health_status != null ||
    account.risk_status != null ||
    account.forecast_summary != null
  );
}
