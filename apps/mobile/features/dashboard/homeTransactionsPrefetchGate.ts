import type { DashboardDetailsSectionState } from "./dashboardSectionState";

/** Section states that mean Upcoming/Goals are no longer competing for first paint. */
const SECTION_SETTLED: ReadonlySet<DashboardDetailsSectionState> = new Set([
  "data",
  "empty",
  "error",
  "hidden",
]);

/**
 * Home is ready for low-priority Transactions prefetch when critical sections
 * for first useful render have settled. Extended cash risk is intentionally
 * excluded — it must not delay likely Transactions navigation.
 *
 * Details success is not required: an error section state counts as settled so
 * Attention → Transactions can still warm after a Details failure.
 */
export function isHomeReadyForTransactionsPrefetch(input: {
  onboarding: boolean;
  summaryFast: unknown;
  fastIsPlaceholderData: boolean;
  fastFetching: boolean;
  detailsFetching: boolean;
  upcomingSectionState: DashboardDetailsSectionState;
  goalsSectionState: DashboardDetailsSectionState;
}): boolean {
  if (input.onboarding) return false;
  if (!input.summaryFast || input.fastIsPlaceholderData || input.fastFetching) {
    return false;
  }
  // Details must have finished requesting (success or error) — not still in flight.
  if (input.detailsFetching) return false;
  if (!SECTION_SETTLED.has(input.upcomingSectionState)) return false;
  if (!SECTION_SETTLED.has(input.goalsSectionState)) return false;
  return true;
}

/**
 * Prefetch lock identity: which destination ledger(s) Home should warm.
 * Does not include balances or other transient presentation values.
 */
export function homeTransactionsPrefetchSignature(input: {
  forecastDays: number;
  householdId?: number | null;
  firstCashShortfallAccountId?: number | null;
  defaultTransactionsAccountId?: number | null;
}): string {
  return [
    input.forecastDays,
    input.householdId ?? "",
    input.firstCashShortfallAccountId ?? "",
    input.defaultTransactionsAccountId ?? "",
  ].join(":");
}
