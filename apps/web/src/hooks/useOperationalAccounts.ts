import { useQuery } from "@tanstack/react-query";
import { listAccounts } from "@budget-app/api-client";

/** Active accounts only — for reconcile, rules, timeline filters, etc. */
export const OPERATIONAL_ACCOUNTS_QUERY_KEY = ["accounts", "operational"] as const;

export function useOperationalAccounts() {
  return useQuery({
    queryKey: OPERATIONAL_ACCOUNTS_QUERY_KEY,
    queryFn: () => listAccounts({ active_only: true, page_size: 500 }),
  });
}
