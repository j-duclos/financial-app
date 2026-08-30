/** Whether cached React Query data is still within staleTime (pure helper for Accounts hooks). */
export function isQueryDataFresh(
  dataUpdatedAt: number | undefined,
  staleTimeMs: number,
  now: number = Date.now()
): boolean {
  if (dataUpdatedAt == null) return false;
  return now - dataUpdatedAt < staleTimeMs;
}

/**
 * Mobile Accounts enrichment enable: wait for the lightweight balance list unless
 * enriched data for the current forecast window is already fresh in cache.
 */
export function accountsListEnrichmentEnabled(input: {
  forecastReady: boolean;
  mainListSuccess: boolean;
  enrichedListUpdatedAt: number | undefined;
  enrichedStaleTimeMs: number;
  now?: number;
}): boolean {
  if (!input.forecastReady) return false;
  if (input.mainListSuccess) return true;
  return isQueryDataFresh(
    input.enrichedListUpdatedAt,
    input.enrichedStaleTimeMs,
    input.now
  );
}
