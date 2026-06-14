import { QueryCache, QueryClient } from "@tanstack/react-query";
import {
  isPerfLoggingEnabled,
  perfLog,
  serializeQueryKey,
} from "@budget-app/api-client";

const fetchStartByQuery = new WeakMap<object, number>();

function createPerfQueryCache(): QueryCache {
  const cache = new QueryCache({
    onSuccess: (_data, query) => {
      if (!isPerfLoggingEnabled()) return;
      const started = fetchStartByQuery.get(query);
      if (started == null) return;
      fetchStartByQuery.delete(query);
      perfLog(
        `[PERF] query success key=${serializeQueryKey(query.queryKey)} elapsed_ms=${Math.round(performance.now() - started)}`
      );
    },
    onError: (_error, query) => {
      if (!isPerfLoggingEnabled()) return;
      const started = fetchStartByQuery.get(query);
      if (started == null) return;
      fetchStartByQuery.delete(query);
      perfLog(
        `[PERF] query error key=${serializeQueryKey(query.queryKey)} elapsed_ms=${Math.round(performance.now() - started)}`
      );
    },
  });

  cache.subscribe((event) => {
    if (!isPerfLoggingEnabled() || event.type !== "updated" || !event.query) return;
    const query = event.query;
    if (query.state.fetchStatus === "fetching" && !fetchStartByQuery.has(query)) {
      fetchStartByQuery.set(query, performance.now());
      perfLog(`[PERF] query fetch start key=${serializeQueryKey(query.queryKey)}`);
    }
  });

  return cache;
}

export function createAppQueryClient(): QueryClient {
  return new QueryClient({
    queryCache: createPerfQueryCache(),
    defaultOptions: {
      queries: {
        retry: 2,
        staleTime: 30_000,
        gcTime: 10 * 60_000,
      },
    },
  });
}
