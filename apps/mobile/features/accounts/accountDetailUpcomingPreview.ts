import type { TimelineRow } from "@budget-app/shared";
import { partitionTimelineForLedger } from "@/features/transactions/buildTransactionList";

/**
 * Bounded Account Detail Upcoming preview: pending then forecast rows in the same
 * canonical order as the Transactions ledger (default filters, account-scoped).
 */
export function accountDetailUpcomingPreviewRows(
  timeline: TimelineRow[] | undefined,
  accountId: number,
  today: string,
  limit: number
): TimelineRow[] {
  const { pending, upcoming } = partitionTimelineForLedger(timeline ?? [], today, accountId);
  return [...pending, ...upcoming].slice(0, limit);
}
