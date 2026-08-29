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
 */
export function isHomeReadyForTransactionsPrefetch(input: {
  onboarding: boolean;
  summaryFast: unknown;
  fastIsPlaceholderData: boolean;
  fastFetching: boolean;
  details: unknown;
  detailsIsPlaceholderData: boolean;
  detailsFetching: boolean;
  upcomingSectionState: DashboardDetailsSectionState;
  goalsSectionState: DashboardDetailsSectionState;
}): boolean {
  if (input.onboarding) return false;
  if (!input.summaryFast || input.fastIsPlaceholderData || input.fastFetching) return false;
  if (!input.details || input.detailsIsPlaceholderData || input.detailsFetching) return false;
  if (!SECTION_SETTLED.has(input.upcomingSectionState)) return false;
  if (!SECTION_SETTLED.has(input.goalsSectionState)) return false;
  return true;
}
