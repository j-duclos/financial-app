import type { OperationalForecastDays } from "@budget-app/shared";

/**
 * Canonical React Query keys for Accounts.
 *
 * Basic balance list and enriched forecast/health list are different shapes /
 * costs, so they keep distinct keys. Account Detail reuses the same list keys
 * (via seed helpers) instead of inventing incompatible per-screen keys for
 * identical server data.
 */
export const accountQueryKeys = {
  /** Lightweight list: ?balance=true (no forecast/health). */
  mainList: () => ["accounts", "main", "mobile"] as const,
  /** Enriched list: balance + forecast_summary + health for forecastDays. */
  enrichedList: (forecastDays: OperationalForecastDays) =>
    ["accounts", "enriched", { forecastDays, scope: "mobile" }] as const,
  /** Single-account balance-only retrieve (progressive detail shell). */
  balanceDetail: (accountId: number) => ["account", accountId, "balance"] as const,
  /** Bounded recent preview for Account Detail (unreconciled, descending). */
  recentPreview: (accountId: number) =>
    ["transactions", "account-preview", accountId, { limit: ACCOUNT_DETAIL_PREVIEW_LIMIT }] as const,
  /** Account Detail Upcoming uses `transactionQueryKeys.timeline` (canonical ledger). */
};

/** Max rows for Account Detail Recent / Upcoming previews. */
export const ACCOUNT_DETAIL_PREVIEW_LIMIT = 5;
