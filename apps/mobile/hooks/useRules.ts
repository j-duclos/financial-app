import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { listRules } from "@budget-app/api-client";
import { useAuth } from "@/features/auth";

export const RULES_QUERY_KEY = ["rules"] as const;
export const RULES_STALE_MS = 60_000;

/**
 * Canonical recurring rules list — shared by Automation, Recurring, What-If, and Goals forms
 * when the default unfiltered list is sufficient.
 */
export function useRules(options: { enabled?: boolean } = {}) {
  const { auth } = useAuth();
  const enabled = (options.enabled ?? true) && auth.isAuthenticated;

  const query = useQuery({
    queryKey: RULES_QUERY_KEY,
    queryFn: () => listRules(),
    enabled,
    staleTime: RULES_STALE_MS,
  });

  const rules = useMemo(() => query.data?.results ?? [], [query.data?.results]);

  return {
    ...query,
    rules,
  };
}
