import type { QueryClient } from "@tanstack/react-query";
import type { TimelineRow } from "@budget-app/shared";

/** Batch timeline rebuilds — one server call after rapid edits instead of one per keystroke/save. */
const TIMELINE_DEBOUNCE_MS = 2500;
const ACCOUNTS_DEBOUNCE_MS = 4000;

let timelineTimer: ReturnType<typeof setTimeout> | null = null;
let accountsTimer: ReturnType<typeof setTimeout> | null = null;

/** Server timeline refetches can lag behind a save — keep client patches until rows match. */
const pendingTimelineEdits = new Map<
  number,
  { date?: string; payee?: string; amount?: string }
>();

export type TimelinePatchScope = {
  timelineStart: string;
  timelineEnd: string;
  accountId: number;
  today: string;
  householdId?: number | null;
};

export type TimelineTransactionPatch = {
  transactionId: number;
  date?: string;
  payee?: string;
  amount?: string;
};

function timelineQueryKeys(scope: TimelinePatchScope): readonly (readonly unknown[])[] {
  const keys: (readonly unknown[])[] = [
    ["timeline", scope.timelineStart, scope.timelineEnd, scope.accountId, scope.today],
  ];
  if (scope.householdId != null) {
    keys.push([
      "timeline",
      "household",
      scope.timelineStart,
      scope.timelineEnd,
      scope.householdId,
      scope.today,
    ]);
  }
  return keys;
}

function applyPatchToTimelineRow(
  row: TimelineRow,
  patch: TimelineTransactionPatch
): TimelineRow {
  if (row.transaction_id !== patch.transactionId) return row;
  return {
    ...row,
    ...(patch.date != null && { date: patch.date }),
    ...(patch.payee != null && { description: patch.payee }),
    ...(patch.amount != null && { amount: patch.amount }),
  };
}

function patchTimelinePayload(
  old: { timeline?: TimelineRow[] } | undefined,
  patch: TimelineTransactionPatch
): { timeline?: TimelineRow[] } | undefined {
  if (!old?.timeline) return old;
  return {
    ...old,
    timeline: old.timeline.map((r) => applyPatchToTimelineRow(r, patch)),
  };
}

/** Immediately update cached timeline rows so running balance stays correct before/after save. */
export function patchTimelineCachesForTransaction(
  queryClient: QueryClient,
  scope: TimelinePatchScope,
  patch: TimelineTransactionPatch
): void {
  pendingTimelineEdits.set(patch.transactionId, {
    date: patch.date,
    payee: patch.payee,
    amount: patch.amount,
  });
  for (const key of timelineQueryKeys(scope)) {
    queryClient.setQueryData(key, (old) => patchTimelinePayload(old, patch));
  }
}

function serverTimelineMatchesPending(timeline: TimelineRow[]): boolean {
  for (const [txnId, pending] of pendingTimelineEdits) {
    const row = timeline.find((r) => r.transaction_id === txnId);
    if (!row) continue;
    if (pending.date != null && row.date !== pending.date) return false;
    if (pending.amount != null && row.amount !== pending.amount) return false;
    if (pending.payee != null && row.description !== pending.payee) return false;
  }
  return true;
}

function reapplyPendingTimelinePatches(
  queryClient: QueryClient,
  scope: TimelinePatchScope
): void {
  if (pendingTimelineEdits.size === 0) return;
  for (const key of timelineQueryKeys(scope)) {
    queryClient.setQueryData(key, (old: { timeline?: TimelineRow[] } | undefined) => {
      if (!old?.timeline) return old;
      let timeline = old.timeline;
      for (const [txnId, pending] of pendingTimelineEdits) {
        timeline = patchTimelinePayload(timeline, {
          transactionId: txnId,
          ...pending,
        })!.timeline!;
      }
      return { ...old, timeline };
    });
  }
}

function clearMatchingPendingEdits(timeline: TimelineRow[]): void {
  for (const [txnId, pending] of [...pendingTimelineEdits.entries()]) {
    const row = timeline.find((r) => r.transaction_id === txnId);
    if (!row) continue;
    const dateOk = pending.date == null || row.date === pending.date;
    const amountOk = pending.amount == null || row.amount === pending.amount;
    const payeeOk = pending.payee == null || row.description === pending.payee;
    if (dateOk && amountOk && payeeOk) {
      pendingTimelineEdits.delete(txnId);
    }
  }
}

export function scheduleTimelineRefresh(
  queryClient: QueryClient,
  scope?: TimelinePatchScope,
  delayMs = TIMELINE_DEBOUNCE_MS
): void {
  if (timelineTimer) clearTimeout(timelineTimer);
  timelineTimer = setTimeout(() => {
    timelineTimer = null;
    // refetchQueries (not invalidate) keeps patched cache visible while the server rebuilds.
    void queryClient
      .refetchQueries({ queryKey: ["timeline"], type: "active" })
      .finally(() => {
        if (!scope) return;
        for (const key of timelineQueryKeys(scope)) {
          const data = queryClient.getQueryData<{ timeline?: TimelineRow[] }>(key);
          if (!data?.timeline) continue;
          if (serverTimelineMatchesPending(data.timeline)) {
            clearMatchingPendingEdits(data.timeline);
          } else {
            reapplyPendingTimelinePatches(queryClient, scope);
          }
        }
      });
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

/** Light refresh after a single transaction edit — timeline stays patched until server catches up. */
export function refreshAfterTransactionEdit(
  queryClient: QueryClient,
  scope: TimelinePatchScope | null,
  opts?: { refreshTimeline?: boolean; refreshAccounts?: boolean; skipTransactionsInvalidate?: boolean }
): void {
  if (!opts?.skipTransactionsInvalidate) {
    void queryClient.refetchQueries({ queryKey: ["transactions"], type: "active" });
  }
  if (scope == null) return;
  if (opts?.refreshTimeline !== false) {
    scheduleTimelineRefresh(queryClient, scope);
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
  pendingTimelineEdits.clear();
  void queryClient.invalidateQueries({ queryKey: ["timeline"] });
  void queryClient.invalidateQueries({ queryKey: ["accounts"] });
  void queryClient.invalidateQueries({ queryKey: ["account"] });
  void queryClient.invalidateQueries({ queryKey: ["dashboard-summary"] });
}
