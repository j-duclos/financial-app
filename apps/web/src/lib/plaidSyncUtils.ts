import type { QueryClient } from "@tanstack/react-query";

const SESSION_KEY_PREFIX = "budget-app.plaid.auto-sync.at";
/** Match backend PLAID_SYNC_MIN_INTERVAL_SECONDS default (5 minutes). */
export const PLAID_AUTO_SYNC_MIN_MS = 5 * 60 * 1000;

export function plaidAutoSyncSessionKey(userId: number): string {
  return `${SESSION_KEY_PREFIX}:${userId}`;
}

export function shouldSkipPlaidAutoSync(userId: number, now = Date.now()): boolean {
  try {
    const raw = sessionStorage.getItem(plaidAutoSyncSessionKey(userId));
    if (!raw) return false;
    const last = Number(raw);
    return Number.isFinite(last) && now - last < PLAID_AUTO_SYNC_MIN_MS;
  } catch {
    return false;
  }
}

export function markPlaidAutoSyncRan(userId: number, now = Date.now()): void {
  try {
    sessionStorage.setItem(plaidAutoSyncSessionKey(userId), String(now));
  } catch {
    /* ignore */
  }
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

export function formatPlaidSyncSummary(totals: {
  added?: number;
  modified?: number;
  removed?: number;
  merged?: number;
}): string | null {
  const parts = [
    totals.added ? `${totals.added} new` : null,
    totals.merged ? `${totals.merged} linked to your manual entries` : null,
    totals.modified ? `${totals.modified} updated` : null,
    totals.removed ? `${totals.removed} removed` : null,
  ].filter(Boolean);
  return parts.length ? parts.join(", ") : null;
}
