import {
  selectHomeTransactionsPrefetchAccountIds,
  type HomeTransactionsPrefetchAccountInput,
} from "./attentionPrefetch";

/**
 * Low-priority Transactions/timeline prefetch starts only after Home already
 * shows meaningful financial data. It must not compete with the first
 * accounts list or the first summary-fast request.
 *
 * Details / Upcoming / Goals are not required — those stay on their own
 * section skeletons.
 */
export function isHomeReadyForTransactionsPrefetch(input: {
  onboarding: boolean;
  primaryContentVisible: boolean;
  summaryFast: unknown;
  fastError: boolean;
  fastIsPlaceholderData: boolean;
}): boolean {
  if (input.onboarding) return false;
  if (!input.primaryContentVisible) return false;
  if (input.fastIsPlaceholderData) return false;
  if (!input.summaryFast && !input.fastError) return false;
  return true;
}

/**
 * Prefetch lock identity from the actual selected destination ledger IDs
 * (`selectHomeTransactionsPrefetchAccountIds`), not a partial reimplementation.
 * Does not include balances or other transient presentation values.
 */
export function homeTransactionsPrefetchSignature(
  input: HomeTransactionsPrefetchAccountInput & {
    forecastDays: number;
    householdId?: number | null;
  }
): string {
  const selectedAccountIds = selectHomeTransactionsPrefetchAccountIds(input);
  return `${input.forecastDays}:${input.householdId ?? ""}:${selectedAccountIds.join(",")}`;
}
