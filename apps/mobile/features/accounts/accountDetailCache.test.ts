import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getAccount, listAccounts } from "@budget-app/api-client";
import type { PaginatedResponse } from "@budget-app/api-client";
import type { Account } from "@budget-app/shared";
import {
  BALANCE_DETAIL_STALE_MS,
  fetchEnrichedAccountDetail,
  refreshAccountDetailResources,
  resolveBalanceDetailInitialData,
} from "./accountDetailQueries";
import { accountQueryKeys } from "./queryKeys";

vi.mock("@budget-app/api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@budget-app/api-client")>();
  return {
    ...actual,
    getAccount: vi.fn(),
    listAccounts: vi.fn(),
  };
});

function cashAccount(overrides: Partial<Account> = {}): Account {
  return {
    id: 7,
    household: 1,
    name: "360 Checking",
    account_type: "CHECKING",
    role: "spending",
    currency: "USD",
    is_active: true,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    balance: "400.00",
    available_balance: "400.00",
    ...overrides,
  } as Account;
}

function mountBalanceDetailObserver(
  queryClient: QueryClient,
  accountId: number,
  forecastDays: 30 | 60 | 90 = 30
) {
  const initial = resolveBalanceDetailInitialData(queryClient, accountId, forecastDays);
  const observer = new QueryObserver(queryClient, {
    queryKey: accountQueryKeys.balanceDetail(accountId),
    queryFn: () => getAccount(accountId, true),
    initialData: initial.data,
    initialDataUpdatedAt: initial.updatedAt,
    staleTime: BALANCE_DETAIL_STALE_MS,
    retry: false,
  });
  const unsubscribe = observer.subscribe(() => undefined);
  return { observer, unsubscribe, initial };
}

describe("resolveBalanceDetailInitialData", () => {
  it("prefers enriched list cache and preserves its dataUpdatedAt", () => {
    const queryClient = new QueryClient();
    const account = cashAccount({
      forecast_summary: { current_balance: "400.00" },
      available_to_spend: "250.00",
    });
    const enrichedUpdatedAt = 900_000;
    queryClient.setQueryData(
      accountQueryKeys.enrichedList(30),
      { count: 1, next: null, previous: null, results: [account] } satisfies PaginatedResponse<Account>,
      { updatedAt: enrichedUpdatedAt }
    );

    const initial = resolveBalanceDetailInitialData(queryClient, 7, 30);
    expect(initial.data).toEqual(account);
    expect(initial.updatedAt).toBe(enrichedUpdatedAt);
  });

  it("falls back to main list cache with source dataUpdatedAt", () => {
    const queryClient = new QueryClient();
    const account = cashAccount();
    const mainUpdatedAt = 800_000;
    queryClient.setQueryData(
      accountQueryKeys.mainList(),
      { count: 1, next: null, previous: null, results: [account] } satisfies PaginatedResponse<Account>,
      { updatedAt: mainUpdatedAt }
    );

    const initial = resolveBalanceDetailInitialData(queryClient, 7, 30);
    expect(initial.data).toEqual(account);
    expect(initial.updatedAt).toBe(mainUpdatedAt);
  });
});

describe("Account Detail balance query mount", () => {
  beforeEach(() => {
    vi.mocked(getAccount).mockReset();
    vi.mocked(listAccounts).mockReset();
  });

  it("fresh Accounts list cache → cached balance → zero immediate balance-only retrieve", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const account = cashAccount();
    const freshUpdatedAt = Date.now() - 5_000;
    queryClient.setQueryData(
      accountQueryKeys.mainList(),
      { count: 1, next: null, previous: null, results: [account] } satisfies PaginatedResponse<Account>,
      { updatedAt: freshUpdatedAt }
    );

    vi.mocked(getAccount).mockResolvedValue(cashAccount({ available_balance: "999.00" }));

    const { observer, unsubscribe, initial } = mountBalanceDetailObserver(queryClient, 7, 30);
    await Promise.resolve();

    expect(initial.data).toEqual(account);
    expect(observer.getCurrentResult().data).toEqual(account);
    expect(observer.getCurrentResult().isFetching).toBe(false);
    expect(getAccount).not.toHaveBeenCalled();

    unsubscribe();
  });

  it("stale Accounts list cache → cached shell → background balance retrieve allowed", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const account = cashAccount();
    const staleUpdatedAt = Date.now() - BALANCE_DETAIL_STALE_MS - 5_000;
    queryClient.setQueryData(
      accountQueryKeys.mainList(),
      { count: 1, next: null, previous: null, results: [account] } satisfies PaginatedResponse<Account>,
      { updatedAt: staleUpdatedAt }
    );

    vi.mocked(getAccount).mockResolvedValue(cashAccount({ available_balance: "410.00" }));

    const { observer, unsubscribe, initial } = mountBalanceDetailObserver(queryClient, 7, 30);

    await vi.waitFor(() => {
      expect(getAccount).toHaveBeenCalledTimes(1);
    });

    expect(initial.data).toEqual(account);
    expect(observer.getCurrentResult().data).toEqual(account);
    expect(getAccount).toHaveBeenCalledWith(7, true);

    unsubscribe();
  });
});

describe("refreshAccountDetailResources", () => {
  beforeEach(() => {
    vi.mocked(getAccount).mockReset();
    vi.mocked(listAccounts).mockReset();
  });

  it("explicit pull refresh refreshes forecast/health even when enrichment already existed", async () => {
    const queryClient = new QueryClient();
    const enriched = cashAccount({
      forecast_summary: { current_balance: "400.00" },
      available_to_spend: "250.00",
      health_status: "healthy",
    });
    queryClient.setQueryData(accountQueryKeys.enrichedList(30), {
      count: 1,
      next: null,
      previous: null,
      results: [enriched],
    } satisfies PaginatedResponse<Account>);

    const refreshed = cashAccount({
      forecast_summary: { current_balance: "420.00" },
      available_to_spend: "300.00",
      health_status: "watch",
    });
    vi.mocked(getAccount).mockResolvedValue(refreshed);

    await refreshAccountDetailResources({
      queryClient,
      accountId: 7,
      forecastDays: 30,
      forecastReady: true,
      refetchRecent: async () => undefined,
      refetchUpcoming: async () => undefined,
      refetchBalanceOnly: async () => {
        throw new Error("balance-only refetch should not run when forecast is ready");
      },
    });

    expect(getAccount).toHaveBeenCalledTimes(1);
    expect(getAccount).toHaveBeenCalledWith(7, true, {
      forecast_summary: true,
      health: true,
      days: 30,
    });
    expect(listAccounts).not.toHaveBeenCalled();
    expect(queryClient.getQueryData(accountQueryKeys.balanceDetail(7))).toEqual(refreshed);
    expect(
      queryClient.getQueryData<PaginatedResponse<Account>>(accountQueryKeys.enrichedList(30))?.results?.[0]
    ).toMatchObject({ health_status: "watch" });
  });

  it("uses balance-only retrieve when forecast is not ready", async () => {
    const queryClient = new QueryClient();
    let balanceOnlyCalled = false;

    await refreshAccountDetailResources({
      queryClient,
      accountId: 7,
      forecastDays: 30,
      forecastReady: false,
      refetchRecent: async () => undefined,
      refetchUpcoming: async () => undefined,
      refetchBalanceOnly: async () => {
        balanceOnlyCalled = true;
      },
    });

    expect(balanceOnlyCalled).toBe(true);
    expect(getAccount).not.toHaveBeenCalled();
  });
});

describe("fetchEnrichedAccountDetail", () => {
  beforeEach(() => {
    vi.mocked(getAccount).mockReset();
  });

  it("updates balanceDetail and merges into enriched list without listAccounts", async () => {
    const queryClient = new QueryClient();
    const account = cashAccount({
      forecast_summary: { current_balance: "500.00" },
      available_to_spend: "400.00",
    });
    vi.mocked(getAccount).mockResolvedValue(account);

    await fetchEnrichedAccountDetail(queryClient, 7, 30);

    expect(getAccount).toHaveBeenCalledTimes(1);
    expect(queryClient.getQueryData(accountQueryKeys.balanceDetail(7))).toEqual(account);
    expect(
      queryClient.getQueryData<PaginatedResponse<Account>>(accountQueryKeys.enrichedList(30))?.results
    ).toHaveLength(1);
  });
});
