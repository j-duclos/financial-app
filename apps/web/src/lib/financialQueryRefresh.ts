import type { QueryClient } from "@tanstack/react-query";

/** Batch timeline rebuilds on Reconcile — not used for Transactions balance edits. */
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
    void queryClient.refetchQueries({ queryKey: ["timeline"], type: "active" });
  }, delayMs);
}

export function scheduleAccountsRefresh(
  queryClient: QueryClient,
  delayMs = ACCOUNTS_DEBOUNCE_MS
): void {
  if (accountsTimer) clearTimeout(accountsTimer);
  accountsTimer = setTimeout(() => {
    accountsTimer = null;
    void queryClient.refetchQueries({ queryKey: ["accounts"], type: "active" });
    void queryClient.refetchQueries({ queryKey: ["account"], type: "active" });
    void queryClient.refetchQueries({ queryKey: ["dashboard-summary"], type: "active" });
  }, delayMs);
}

/** Immediate refresh after a transaction edit — authoritative timeline and account balances. */
export function refreshAfterTransactionEdit(
  queryClient: QueryClient,
  opts?: {
    refreshTimeline?: boolean;
    refreshAccounts?: boolean;
    skipTransactionsInvalidate?: boolean;
  }
): void {
  if (!opts?.skipTransactionsInvalidate) {
    void queryClient.refetchQueries({ queryKey: ["transactions"], type: "active" });
  }
  if (opts?.refreshTimeline !== false) {
    void queryClient.cancelQueries({ queryKey: ["timeline"] });
    void queryClient.refetchQueries({ queryKey: ["timeline"], type: "active" });
  }
  if (opts?.refreshAccounts) {
    void queryClient.refetchQueries({ queryKey: ["accounts"], type: "active" });
    void queryClient.refetchQueries({ queryKey: ["account"], type: "active" });
    void queryClient.refetchQueries({ queryKey: ["dashboard-summary"], type: "active" });
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
