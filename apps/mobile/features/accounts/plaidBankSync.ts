import type { QueryClient } from "@tanstack/react-query";
import { syncAllPlaidItems, type PlaidSyncAllResult } from "@budget-app/api-client";
import { refreshAfterPlaidSync } from "@/lib/financialQueryRefresh";
import { recordPlaidRefreshTiming } from "@/lib/startupTrace";

export function formatPlaidSyncSummary(totals: {
  added?: number;
  modified?: number;
  removed?: number;
  merged?: number;
  skipped_sync_disabled_accounts?: number;
  skipped_items?: number;
  synced_items?: number;
  failed_items?: number;
  reason?: string;
}): string | null {
  if (totals.reason === "sync_disabled") {
    return "No linked accounts are eligible for import (check account status).";
  }
  const parts = [
    totals.added ? `${totals.added} new` : null,
    totals.merged ? `${totals.merged} linked to your manual entries` : null,
    totals.modified ? `${totals.modified} updated` : null,
    totals.removed ? `${totals.removed} removed` : null,
    totals.skipped_sync_disabled_accounts
      ? `${totals.skipped_sync_disabled_accounts} account(s) skipped (import paused)`
      : null,
  ].filter(Boolean);
  if ((totals.failed_items ?? 0) > 0 && parts.length === 0) {
    return "Bank import failed. Try Sync banks again, or reconnect the bank if login expired.";
  }
  return parts.length ? parts.join(", ") : null;
}

export function plaidSyncChangedData(result: PlaidSyncAllResult): boolean {
  const totals = result.totals ?? {};
  return (totals.added ?? 0) + (totals.modified ?? 0) + (totals.merged ?? 0) > 0;
}

/** Import from every linked Plaid login, then refresh ledger/account caches. */
export async function runHouseholdPlaidSync(options: {
  householdId: number;
  force: boolean;
  queryClient: QueryClient;
}): Promise<PlaidSyncAllResult> {
  const started = Date.now();
  try {
    const result = await syncAllPlaidItems({
      household: options.householdId,
      force: options.force,
    });
    recordPlaidRefreshTiming({
      durationMs: Date.now() - started,
      changedData: plaidSyncChangedData(result),
    });
    refreshAfterPlaidSync(options.queryClient);
    return result;
  } catch (err) {
    recordPlaidRefreshTiming({ durationMs: Date.now() - started, changedData: false });
    throw err;
  }
}
