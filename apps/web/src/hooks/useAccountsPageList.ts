import { useMemo, useRef, useState, useEffect } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { listAccounts } from "@budget-app/api-client";
import type { Account } from "@budget-app/shared";
import type { AccountOrganizationFilters } from "../lib/accountOrganization";
import type { PassiveForecastDays } from "../lib/safeToSpendLabels";

function listScopeParams(filters: AccountOrganizationFilters) {
  return {
    include_deleted: filters.showDeleted,
    include_closed: filters.showClosed,
    include_archived: filters.showArchived,
  };
}

/**
 * Accounts page: show balances as soon as possible; load forecast/health in the background.
 * keepPreviousData prevents the list from flashing empty during refetch (Plaid sync, edits, etc.).
 */
export function useAccountsPageList(
  forecastDays: PassiveForecastDays,
  filters: AccountOrganizationFilters
) {
  const scope = listScopeParams(filters);
  const lastNonEmpty = useRef<Account[]>([]);
  const [enableEnrich, setEnableEnrich] = useState(false);

  useEffect(() => {
    const t = window.setTimeout(() => setEnableEnrich(true), 2000);
    return () => window.clearTimeout(t);
  }, []);

  const mainQuery = useQuery({
    queryKey: ["accounts", "main", scope],
    queryFn: () =>
      listAccounts({
        balance: "true",
        page_size: 500,
        ...scope,
      }),
    placeholderData: keepPreviousData,
    staleTime: 30_000,
    retry: 3,
    refetchOnWindowFocus: false,
  });

  const enrichQuery = useQuery({
    queryKey: ["accounts", "enriched", { ...scope, forecastDays }],
    queryFn: () =>
      listAccounts({
        balance: "true",
        forecast_summary: "true",
        health: "true",
        days: forecastDays,
        page_size: 500,
        ...scope,
      }),
    enabled: mainQuery.isSuccess && enableEnrich,
    placeholderData: keepPreviousData,
    staleTime: 60_000,
    retry: 1,
    refetchOnWindowFocus: false,
  });

  const accounts: Account[] = useMemo(() => {
    const enriched =
      enrichQuery.isSuccess && enrichQuery.data?.results?.length
        ? enrichQuery.data.results
        : null;
    const main = mainQuery.data?.results;
    const next = enriched ?? main ?? lastNonEmpty.current;
    if (next.length > 0) lastNonEmpty.current = next;
    return next;
  }, [
    mainQuery.data,
    mainQuery.isSuccess,
    enrichQuery.data,
    enrichQuery.isSuccess,
  ]);

  const isLoading = mainQuery.isPending && accounts.length === 0;
  const isError = accounts.length === 0 && mainQuery.isError;

  return {
    accounts,
    isLoading,
    isEnriching: enrichQuery.isFetching && accounts.length > 0,
    enrichFailed: enrichQuery.isError && !enrichQuery.isFetching && accounts.length > 0,
    isError,
    error: mainQuery.error,
    refetch: () => {
      void mainQuery.refetch();
      if (mainQuery.isSuccess) void enrichQuery.refetch();
    },
  };
}
