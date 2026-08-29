import type { QueryClient } from "@tanstack/react-query";
import type {
  DashboardAttentionItem,
  OperationalForecastDays,
} from "@budget-app/shared";
import { prefetchDefaultLedgerQueries } from "@/features/transactions/defaultLedgerPrefetch";
import { attentionCardOpensLedger } from "./navigation";
import { markTransactionsPrefetchTiming } from "./transactionsPrefetchTiming";

export type HomeTransactionsPrefetchAccountInput = {
  /** Earliest cash shortfall account from summary-fast (highest priority). */
  firstCashShortfallAccountId?: number | null;
  /** Visible Attention cards — first cash-risk / ledger card is fallback priority. */
  attention: DashboardAttentionItem[];
  /**
   * Current/default Transactions account (session last-viewed, else profile default).
   * Prefetched second when different from the shortfall/risk account.
   */
  defaultTransactionsAccountId?: number | null;
};

/**
 * Priority account selection for Home → Transactions prefetch.
 *
 * 1. First cash-shortfall / cash-risk account
 * 2. Current/default Transactions account if different
 *
 * Never returns every Attention account — at most two ledgers.
 */
export function selectHomeTransactionsPrefetchAccountIds(
  input: HomeTransactionsPrefetchAccountInput
): number[] {
  const ordered: number[] = [];
  const push = (id: number | null | undefined) => {
    if (id == null || !Number.isInteger(id) || id <= 0) return;
    if (!ordered.includes(id)) ordered.push(id);
  };

  push(input.firstCashShortfallAccountId ?? null);

  if (ordered.length === 0) {
    for (const item of input.attention) {
      if (attentionCardOpensLedger(item)) {
        push(item.account_id);
        break;
      }
    }
  }

  push(input.defaultTransactionsAccountId ?? null);
  return ordered;
}

export type PrefetchHomeTransactionsInput = HomeTransactionsPrefetchAccountInput & {
  forecastDays: OperationalForecastDays;
  householdId?: number | null;
};

/**
 * Low-priority prefetch of the default Transactions ledger queries for the
 * highest-priority account(s). Credit Attention destinations are skipped
 * (they open Account Detail, not Transactions).
 *
 * Prefetches raw API results only — no balance transforms on Home.
 */
export async function prefetchHomeTransactionsDestinations(
  queryClient: QueryClient,
  input: PrefetchHomeTransactionsInput
): Promise<void> {
  const accountIds = selectHomeTransactionsPrefetchAccountIds(input);
  if (accountIds.length === 0) return;

  markTransactionsPrefetchTiming("prefetch-start", {
    accounts: accountIds.join(","),
  });

  for (const accountId of accountIds) {
    const result = await prefetchDefaultLedgerQueries(queryClient, {
      accountId,
      forecastDays: input.forecastDays,
      householdId: input.householdId ?? null,
    });

    if (result.recentMs != null) {
      markTransactionsPrefetchTiming("recent-prefetch-done", {
        accountId: String(accountId),
        ms: String(result.recentMs),
      });
    } else if (result.recentSkipped) {
      markTransactionsPrefetchTiming("recent-prefetch-skipped", {
        accountId: String(accountId),
      });
    }

    if (result.timelineMs != null) {
      markTransactionsPrefetchTiming("timeline-prefetch-done", {
        accountId: String(accountId),
        ms: String(result.timelineMs),
      });
    } else if (result.timelineSkipped) {
      markTransactionsPrefetchTiming("timeline-prefetch-skipped", {
        accountId: String(accountId),
      });
    }
  }

  markTransactionsPrefetchTiming("prefetch-complete", {
    accounts: accountIds.join(","),
  });
}
