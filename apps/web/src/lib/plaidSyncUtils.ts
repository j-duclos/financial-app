import type { QueryClient } from "@tanstack/react-query";
import type { PlaidSyncAllResult } from "@budget-app/api-client";

/** Minimum gap between automatic background sync attempts (avoids Plaid hammering on refresh spam). */
export const PLAID_AUTO_SYNC_DEBOUNCE_MS = 45_000;

/** When returning to the tab, sync again if last attempt was longer ago than this. */
export const PLAID_AUTO_SYNC_VISIBILITY_MS = 10 * 60 * 1000;

let lastAutoSyncAttemptAt = 0;

export function canRunPlaidAutoSync(now = Date.now()): boolean {
  return now - lastAutoSyncAttemptAt >= PLAID_AUTO_SYNC_DEBOUNCE_MS;
}

export function markPlaidAutoSyncAttempt(now = Date.now()): void {
  lastAutoSyncAttemptAt = now;
}

export function msSinceLastPlaidAutoSync(now = Date.now()): number {
  return now - lastAutoSyncAttemptAt;
}

export async function invalidateQueriesAfterPlaidSync(queryClient: QueryClient): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: ["transactions"] }),
    queryClient.invalidateQueries({ queryKey: ["accounts"] }),
    queryClient.invalidateQueries({ queryKey: ["timeline"] }),
    queryClient.invalidateQueries({ queryKey: ["dashboard-summary"] }),
    queryClient.invalidateQueries({ queryKey: ["plaid-items"] }),
  ]);
}

export function plaidAutoSyncSummary(result: PlaidSyncAllResult): string | null {
  const totals = result.totals;
  if ((totals.failed_items ?? 0) > 0 && (totals.synced_items ?? 0) === 0) {
    return "Bank import failed — use Sync now on Accounts.";
  }
  return formatPlaidSyncSummary(totals);
}

export function formatPlaidSyncSummary(totals: {
  added?: number;
  modified?: number;
  removed?: number;
  merged?: number;
  skipped_sync_disabled_accounts?: number;
  skipped_items?: number;
  synced_items?: number;
  reason?: string;
}): string | null {
  if (totals.reason === "sync_disabled") {
    return "skipped — no linked accounts are eligible for import (check account status)";
  }
  const parts = [
    totals.added ? `${totals.added} new` : null,
    totals.merged ? `${totals.merged} linked to your manual entries` : null,
    totals.modified ? `${totals.modified} updated` : null,
    totals.removed ? `${totals.removed} removed` : null,
    totals.skipped_sync_disabled_accounts
      ? `${totals.skipped_sync_disabled_accounts} account(s) skipped (import paused or inactive)`
      : null,
  ].filter(Boolean);
  return parts.length ? parts.join(", ") : null;
}

export const PLAID_AUTO_SYNC_EVENT = "budget-app:plaid-auto-sync";

export function dispatchPlaidAutoSyncEvent(detail: {
  ok: boolean;
  summary: string | null;
  error?: string;
}): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(PLAID_AUTO_SYNC_EVENT, { detail }));
}
