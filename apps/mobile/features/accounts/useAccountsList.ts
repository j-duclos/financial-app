import { useMemo, useRef } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { listAccounts } from "@budget-app/api-client";
import type { Account } from "@budget-app/shared";
import type { OperationalForecastDays } from "@budget-app/shared";

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

export function useAccountsList(forecastDays: OperationalForecastDays) {
  const lastNonEmpty = useRef<Account[]>([]);

  const mainQuery = useQuery({
    queryKey: ["accounts", "main", "mobile"],
    queryFn: () => listAccounts({ balance: "true", page_size: 500, active_only: true }),
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });

  const enrichQuery = useQuery({
    queryKey: ["accounts", "enriched", { forecastDays, scope: "mobile" }],
    queryFn: () =>
      listAccounts({
        balance: "true",
        forecast_summary: "true",
        health: "true",
        days: forecastDays,
        page_size: 500,
        active_only: true,
      }),
    enabled: mainQuery.isSuccess,
    placeholderData: keepPreviousData,
    staleTime: 60_000,
  });

  const accounts = useMemo(() => {
    const main = mainQuery.data?.results ?? lastNonEmpty.current;
    const enriched = enrichQuery.isSuccess ? enrichQuery.data?.results : undefined;
    const next = mergeEnrichedAccounts(main, enriched);
    if (next.length > 0) lastNonEmpty.current = next;
    return next;
  }, [mainQuery.data, enrichQuery.data, enrichQuery.isSuccess]);

  return {
    accounts,
    isLoading: mainQuery.isPending && accounts.length === 0,
    isEnriching: enrichQuery.isFetching && accounts.length > 0,
    isError: accounts.length === 0 && mainQuery.isError,
    error: mainQuery.error,
    refetch: () => {
      void mainQuery.refetch();
      if (mainQuery.isSuccess) void enrichQuery.refetch();
    },
  };
}
