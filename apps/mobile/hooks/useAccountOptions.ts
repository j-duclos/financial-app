import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { listAccounts } from "@budget-app/api-client";
import { accountLifecycleStatus } from "@/lib/accountGroups";
import {
  ACCOUNT_OPTIONS_STALE_MS,
  referenceQueryKeys,
} from "@/lib/referenceQueryKeys";

type UseAccountOptionsOptions = {
  /** When omitted, the query stays disabled until a household is known. */
  householdId?: number | null;
  enabled?: boolean;
};

/**
 * Lightweight active accounts for pickers/filters — no forecast, health, or balance enrichment.
 * page_size=500 matches backend reference-list cap; typical households stay well under this limit.
 */
export function useAccountOptions(options: UseAccountOptionsOptions = {}) {
  const householdId = options.householdId ?? null;
  const enabled = (options.enabled ?? true) && householdId != null;

  const query = useQuery({
    queryKey: referenceQueryKeys.accountOptions(householdId),
    queryFn: () =>
      listAccounts({
        active_only: true,
        household: householdId ?? undefined,
        page_size: 500,
      }),
    enabled,
    staleTime: ACCOUNT_OPTIONS_STALE_MS,
  });

  const accounts = useMemo(
    () => (query.data?.results ?? []).filter((a) => accountLifecycleStatus(a) === "active"),
    [query.data?.results]
  );

  return {
    ...query,
    accounts,
    householdId,
  };
}
