import { describe, expect, it, vi, beforeEach } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import {
  defaultLedgerHistoryQueryOptions,
  defaultLedgerTimelineQueryOptions,
  prefetchDefaultLedgerQueries,
} from "@/features/transactions/defaultLedgerPrefetch";
import {
  timelineQueryParams,
  transactionListQueryParams,
  transactionQueryKeys,
} from "@/features/transactions/queryKeys";
import {
  DEFAULT_TRANSACTION_FILTERS,
  TRANSACTIONS_LEDGER_ORDERING,
  TRANSACTIONS_LEDGER_PAGE_SIZE,
} from "@/features/transactions/types";
import {
  ledgerProjectionRange,
  pastTransactionsRange,
} from "@/lib/transactionsLedger";
import {
  selectHomeTransactionsPrefetchAccountIds,
  prefetchHomeTransactionsDestinations,
} from "./attentionPrefetch";
import { isHomeReadyForTransactionsPrefetch } from "./homeTransactionsPrefetchGate";
import type { DashboardAttentionItem } from "@budget-app/shared";

vi.mock("@budget-app/api-client", () => ({
  listTransactions: vi.fn(async () => ({
    count: 1,
    next: null,
    previous: null,
    results: [{ id: 1, date: "2026-08-20", amount: "-10.00" }],
  })),
  getTimeline: vi.fn(async () => ({
    timeline: [{ date: "2026-08-29", transactions: [] }],
  })),
}));

import { listTransactions, getTimeline } from "@budget-app/api-client";

function cashAttention(overrides: Partial<DashboardAttentionItem> = {}): DashboardAttentionItem {
  return {
    account_id: 10,
    account_name: "Main",
    account_role: "spending",
    account_type: "CHECKING",
    status: "risk",
    reason: "Projected negative balance",
    recommended_action: "Move money",
    amount: "50.00",
    risk_date: "2026-09-02",
    first_negative_transaction_id: 99,
    primary_action: { type: "open_ledger", label: "Open ledger", url: "/transactions" },
    secondary_action: { type: "move_money", label: "Fix shortfall", url: "/transfer" },
    url: "/transactions",
    ...overrides,
  };
}

function creditAttention(overrides: Partial<DashboardAttentionItem> = {}): DashboardAttentionItem {
  return {
    account_id: 20,
    account_name: "Visa",
    account_role: "credit_card",
    account_type: "CREDIT",
    status: "watch",
    reason: "High utilization",
    recommended_action: "Pay down",
    amount: "500.00",
    risk_date: null,
    primary_action: { type: "view_account", label: "Open account", url: "/accounts/20" },
    secondary_action: null,
    url: "/accounts/20",
    ...overrides,
  };
}

describe("selectHomeTransactionsPrefetchAccountIds", () => {
  it("prefers first cash-shortfall account, then default if different", () => {
    expect(
      selectHomeTransactionsPrefetchAccountIds({
        firstCashShortfallAccountId: 10,
        attention: [cashAttention({ account_id: 10 }), cashAttention({ account_id: 11 })],
        defaultTransactionsAccountId: 12,
      })
    ).toEqual([10, 12]);
  });

  it("does not duplicate when default matches shortfall account", () => {
    expect(
      selectHomeTransactionsPrefetchAccountIds({
        firstCashShortfallAccountId: 10,
        attention: [cashAttention()],
        defaultTransactionsAccountId: 10,
      })
    ).toEqual([10]);
  });

  it("falls back to first ledger Attention card when no shortfall", () => {
    expect(
      selectHomeTransactionsPrefetchAccountIds({
        firstCashShortfallAccountId: null,
        attention: [creditAttention(), cashAttention({ account_id: 15 })],
        defaultTransactionsAccountId: 15,
      })
    ).toEqual([15]);
  });

  it("skips credit Attention accounts for Transactions prefetch", () => {
    expect(
      selectHomeTransactionsPrefetchAccountIds({
        firstCashShortfallAccountId: null,
        attention: [creditAttention()],
        defaultTransactionsAccountId: 7,
      })
    ).toEqual([7]);
  });

  it("does not return every Attention cash account", () => {
    const ids = selectHomeTransactionsPrefetchAccountIds({
      firstCashShortfallAccountId: 1,
      attention: [
        cashAttention({ account_id: 1 }),
        cashAttention({ account_id: 2 }),
        cashAttention({ account_id: 3 }),
      ],
      defaultTransactionsAccountId: 4,
    });
    expect(ids).toEqual([1, 4]);
    expect(ids).not.toContain(2);
    expect(ids).not.toContain(3);
  });
});

describe("isHomeReadyForTransactionsPrefetch", () => {
  const base = {
    onboarding: false,
    summaryFast: { ok: true },
    fastIsPlaceholderData: false,
    fastFetching: false,
    details: { ok: true },
    detailsIsPlaceholderData: false,
    detailsFetching: false,
    upcomingSectionState: "data" as const,
    goalsSectionState: "data" as const,
  };

  it("requires summary-fast, details, and Upcoming/Goals settled — not extended risk", () => {
    expect(isHomeReadyForTransactionsPrefetch(base)).toBe(true);
    expect(isHomeReadyForTransactionsPrefetch({ ...base, fastFetching: true })).toBe(false);
    expect(isHomeReadyForTransactionsPrefetch({ ...base, detailsFetching: true })).toBe(false);
    expect(
      isHomeReadyForTransactionsPrefetch({ ...base, upcomingSectionState: "loading" })
    ).toBe(false);
    expect(isHomeReadyForTransactionsPrefetch({ ...base, onboarding: true })).toBe(false);
  });
});

describe("default ledger prefetch cache keys", () => {
  it("uses showReconciled false matching Transactions defaults", () => {
    const history = defaultLedgerHistoryQueryOptions(10);
    const expectedParams = transactionListQueryParams({
      accountId: 10,
      categoryId: null,
      dateAfter: pastTransactionsRange("14d").start,
      dateBefore: pastTransactionsRange("14d").end,
      showReconciled: false,
      historyStart: pastTransactionsRange("14d").start,
      search: "",
      ordering: TRANSACTIONS_LEDGER_ORDERING,
      includeRunningBalance: true,
    });
    expect(history.queryKey).toEqual(
      transactionQueryKeys.list({ ...expectedParams, pageSize: TRANSACTIONS_LEDGER_PAGE_SIZE })
    );
    expect(JSON.stringify(history.queryKey)).toContain('"reconciled":false');
    expect(JSON.stringify(history.queryKey)).not.toContain("show_reconciled");
  });

  it("builds timeline key matching useTransactionsData defaults", () => {
    const forecastDays = 30 as const;
    const householdId = 3;
    const timeline = defaultLedgerTimelineQueryOptions({
      accountId: 10,
      forecastDays,
      householdId,
    });
    const range = ledgerProjectionRange(forecastDays);
    expect(timeline.queryKey).toEqual(
      transactionQueryKeys.timeline(
        timelineQueryParams({
          start: range.start,
          end: range.end,
          accountId: 10,
          householdId,
          hideReconciledPast: !DEFAULT_TRANSACTION_FILTERS.showReconciled,
        })
      )
    );
  });
});

describe("prefetchDefaultLedgerQueries", () => {
  beforeEach(() => {
    vi.mocked(listTransactions).mockClear();
    vi.mocked(getTimeline).mockClear();
  });

  it("populates the same query keys Transactions mounts with", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const accountId = 10;
    const forecastDays = 30 as const;
    const householdId = 3;

    await prefetchDefaultLedgerQueries(queryClient, {
      accountId,
      forecastDays,
      householdId,
    });

    const historyKey = defaultLedgerHistoryQueryOptions(accountId).queryKey;
    const timelineKey = defaultLedgerTimelineQueryOptions({
      accountId,
      forecastDays,
      householdId,
    }).queryKey;

    expect(queryClient.getQueryData(historyKey)).toBeTruthy();
    expect(queryClient.getQueryData(timelineKey)).toBeTruthy();
    expect(listTransactions).toHaveBeenCalledTimes(1);
    expect(getTimeline).toHaveBeenCalledTimes(1);

    // Second prefetch is a no-op while fresh (cache HIT).
    await prefetchDefaultLedgerQueries(queryClient, {
      accountId,
      forecastDays,
      householdId,
    });
    expect(listTransactions).toHaveBeenCalledTimes(1);
    expect(getTimeline).toHaveBeenCalledTimes(1);
  });

  it("after prefetch, Transactions-shaped keys are already populated (Attention tap warm path)", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    await prefetchHomeTransactionsDestinations(queryClient, {
      firstCashShortfallAccountId: 10,
      attention: [cashAttention()],
      defaultTransactionsAccountId: 10,
      forecastDays: 30,
      householdId: 3,
    });

    const historyState = queryClient.getQueryState(
      defaultLedgerHistoryQueryOptions(10).queryKey
    );
    const timelineState = queryClient.getQueryState(
      defaultLedgerTimelineQueryOptions({
        accountId: 10,
        forecastDays: 30,
        householdId: 3,
      }).queryKey
    );

    expect(historyState?.data).toBeTruthy();
    expect(timelineState?.data).toBeTruthy();
    // Mounting Transactions would read these keys — no wait for initial network.
    expect(historyState?.status).toBe("success");
    expect(timelineState?.status).toBe("success");
  });
});
