import type { QueryClient } from "@tanstack/react-query";
import { PROFILE_QUERY_KEY } from "@/lib/profileQueryKey";
import { FINANCIAL_QUERY_PREFIXES } from "@/lib/financialQueryRefresh";

const USER_SPECIFIC_PREFIXES = [
  PROFILE_QUERY_KEY,
  ["households"],
  ["categories"],
  ["account-options"],
  ["category-options"],
  ["what-if-scenarios"],
  ["what-if-accounts"],
] as const;

/**
 * Remove cached user-specific server state on logout or forced unauthorized logout.
 * Correctness on account switch takes priority over preserving query cache.
 */
export function clearUserQueryCache(queryClient: QueryClient): void {
  for (const queryKey of USER_SPECIFIC_PREFIXES) {
    queryClient.removeQueries({ queryKey: [...queryKey] });
  }
  for (const queryKey of FINANCIAL_QUERY_PREFIXES) {
    queryClient.removeQueries({ queryKey: [...queryKey] });
  }
  queryClient.removeQueries({
    predicate: (query) => {
      const root = query.queryKey[0];
      return (
        typeof root === "string" &&
        (root.startsWith("what-if-") ||
          root === "accounts" ||
          root === "account" ||
          root === "transactions" ||
          root === "spending-target" ||
          root === "spending-target-edit" ||
          root === "rules")
      );
    },
  });
}
