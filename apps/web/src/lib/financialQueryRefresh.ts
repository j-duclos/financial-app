import type { QueryClient } from "@tanstack/react-query";

/** Batch timeline rebuilds — one server call after rapid edits instead of one per keystroke/save. */
const TIMELINE_DEBOUNCE_MS = 2500;
const ACCOUNTS_DEBOUNCE_MS = 4000;

let timelineTimer: ReturnType<typeof setTimeout> | null = null;
let accountsTimer: ReturnType<typeof setTimeout> | null = null;

export function scheduleTimelineRefresh(
  queryClient: QueryClient,
  delayMs = TIMELINE_DEBOUNCE_MS
): void {
  if (timelineTimer) clearTimeout(timelineTimer);
  timelineTimer = setTimeout(() => {
    timelineTimer = null;
    void queryClient.invalidateQueries({ queryKey: ["timeline"] });
  }, delayMs);
}

export function scheduleAccountsRefresh(
  queryClient: QueryClient,
  delayMs = ACCOUNTS_DEBOUNCE_MS
): void {
  if (accountsTimer) clearTimeout(accountsTimer);
  accountsTimer = setTimeout(() => {
    accountsTimer = null;
    void queryClient.invalidateQueries({ queryKey: ["accounts"] });
    void queryClient.invalidateQueries({ queryKey: ["account"] });
    void queryClient.invalidateQueries({ queryKey: ["dashboard-summary"] });
  }, delayMs);
}

/** Light refresh after a single transaction edit — skip heavy timeline until debounced. */
export function refreshAfterTransactionEdit(
  queryClient: QueryClient,
  opts?: { refreshTimeline?: boolean; refreshAccounts?: boolean }
): void {
  void queryClient.invalidateQueries({ queryKey: ["transactions"] });
  if (opts?.refreshTimeline !== false) {
    scheduleTimelineRefresh(queryClient);
  }
  if (opts?.refreshAccounts) {
    scheduleAccountsRefresh(queryClient);
  }
}

export function flushFinancialRefresh(queryClient: QueryClient): void {
  if (timelineTimer) {
    clearTimeout(timelineTimer);
    timelineTimer = null;
  }
  if (accountsTimer) {
    clearTimeout(accountsTimer);
    accountsTimer = null;
  }
  void queryClient.invalidateQueries({ queryKey: ["timeline"] });
  void queryClient.invalidateQueries({ queryKey: ["accounts"] });
  void queryClient.invalidateQueries({ queryKey: ["account"] });
  void queryClient.invalidateQueries({ queryKey: ["dashboard-summary"] });
}
