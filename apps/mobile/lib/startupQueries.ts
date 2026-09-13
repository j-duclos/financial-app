import type { QueryClient } from "@tanstack/react-query";
import {
  classifyReactQueryCache,
  runTimedStartupQuery,
  type StartupQueryCacheState,
  type StartupQueryName,
} from "./startupTrace";

export function classifyQueryClientCache(
  queryClient: QueryClient,
  queryKey: readonly unknown[],
  staleTimeMs: number
): StartupQueryCacheState {
  const state = queryClient.getQueryState(queryKey);
  return classifyReactQueryCache({
    hasData: state?.data !== undefined,
    dataUpdatedAt: state?.dataUpdatedAt,
    isInvalidated: state?.isInvalidated,
    staleTimeMs,
  });
}

export function timedStartupQueryFn<T>(
  query: StartupQueryName,
  cache: StartupQueryCacheState,
  fn: () => Promise<T>
): Promise<T> {
  return runTimedStartupQuery(query, cache, fn);
}
