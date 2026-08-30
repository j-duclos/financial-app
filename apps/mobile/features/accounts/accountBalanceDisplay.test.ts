import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import type { Account } from "@budget-app/shared";
import type { PaginatedResponse } from "@budget-app/api-client";
import {
  resolveAccountBalanceDisplay,
  resolveAfterPendingBalance,
  resolveListPrimaryBalance,
  resolvePostedCurrentBalance,
  shouldShowAccountHealthBadge,
} from "./accountBalanceDisplay";
import {
  accountHasForecastEnrichment,
  seedAccountFromListCache,
} from "./accountDetailSeed";
import {
  resolveBalanceDetailInitialData,
} from "./accountDetailQueries";
import { accountQueryKeys } from "./queryKeys";

const dir = dirname(fileURLToPath(import.meta.url));
const rowSource = readFileSync(join(dir, "AccountRow.tsx"), "utf8");
const detailSource = readFileSync(join(dir, "AccountDetailScreen.tsx"), "utf8");
const listHookSource = readFileSync(join(dir, "useAccountsList.ts"), "utf8");

function cashAccount(overrides: Partial<Account> = {}): Account {
  return {
    id: 1,
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

describe("account balance semantics", () => {
  it("list and detail share the same Current when enrichment is present", () => {
    const account = cashAccount({
      available_balance: "350.00",
      balance: "350.00",
      forecast_summary: { current_balance: "400.00" },
      available_to_spend: "250.00",
    });
    const list = resolveListPrimaryBalance(account);
    const detail = resolveAccountBalanceDisplay(account);
    expect(list.label).toBe("Current");
    expect(list.amount).toBe("400.00");
    expect(list.afterPending).toBe("350.00");
    expect(detail.kind).toBe("cash");
    if (detail.kind === "cash") {
      expect(detail.primary).toBe(list.amount);
      expect(detail.primaryLabel).toBe("Current balance");
      expect(detail.afterPending).toBe(list.afterPending);
      expect(detail.safeToSpend).toBe("250.00");
    }
  });

  it("does not label pending-inclusive ledger EOD as Current when posted is known", () => {
    const account = cashAccount({
      available_balance: "415.85",
      forecast_summary: { current_balance: "500.00" },
      available_to_spend: "200.00",
      projected_balance_30_days: "100.00",
    });
    const list = resolveListPrimaryBalance(account);
    expect(list.amount).toBe("500.00");
    expect(list.afterPending).toBe("415.85");
    expect(list.amount).not.toBe(account.available_balance);
    expect(resolvePostedCurrentBalance(account)).toBe("500.00");
    expect(resolveAfterPendingBalance(account)).toBe("415.85");
  });

  it("falls back to ledger EOD for Current before enrichment (no silent After pending)", () => {
    const primary = resolveListPrimaryBalance(
      cashAccount({
        available_balance: "415.85",
        available_to_spend: "200.00",
        projected_balance_30_days: "100.00",
      })
    );
    expect(primary).toEqual({
      label: "Current",
      amount: "415.85",
      afterPending: null,
    });
  });

  it("does not show After pending when it matches Current", () => {
    const display = resolveAccountBalanceDisplay(
      cashAccount({
        available_balance: "400.00",
        forecast_summary: { current_balance: "400.00" },
      })
    );
    expect(display.kind).toBe("cash");
    if (display.kind === "cash") {
      expect(display.afterPending).toBeNull();
    }
    expect(resolveListPrimaryBalance(cashAccount({
      available_balance: "400.00",
      forecast_summary: { current_balance: "400.00" },
    })).afterPending).toBeNull();
  });

  it("matched pending (same posted and EOD) is not shown twice as After pending", () => {
    const account = cashAccount({
      available_balance: "500.00",
      balance: "500.00",
      forecast_summary: { current_balance: "500.00" },
    });
    expect(resolvePostedCurrentBalance(account)).toBe("500.00");
    expect(resolveAfterPendingBalance(account)).toBeNull();
    expect(resolveListPrimaryBalance(account).afterPending).toBeNull();
  });

  it("never uses forecast ending or STS as Current", () => {
    const account = cashAccount({
      available_balance: "400.00",
      forecast_summary: { current_balance: "400.00" },
      available_to_spend: "250.00",
      projected_balance_30_days: "100.00",
    });
    expect(resolveListPrimaryBalance(account).amount).toBe("400.00");
    expect(resolveListPrimaryBalance(account).amount).not.toBe("250.00");
    expect(resolveListPrimaryBalance(account).amount).not.toBe("100.00");
  });

  it("uses credit semantics for credit accounts", () => {
    const display = resolveAccountBalanceDisplay(
      cashAccount({
        account_type: "CREDIT",
        balance_owed: "926.24",
        available_credit: "3873.76",
        credit_limit: "4800.00",
        utilization_percent: "19.30",
        available_balance: "3873.76",
      })
    );
    expect(display.kind).toBe("credit");
    if (display.kind === "credit") {
      expect(display.owed).toBe("926.24");
      expect(display.availableCredit).toBe("3873.76");
      expect(display.creditLimit).toBe("4800.00");
    }
    expect(resolveListPrimaryBalance(cashAccount({
      account_type: "CREDIT",
      balance_owed: "926.24",
    }))).toEqual({ label: "Owed", amount: "926.24", afterPending: null });
  });

  it("hides healthy list badges and keeps watch/risk/critical", () => {
    expect(shouldShowAccountHealthBadge("healthy")).toBe(false);
    expect(shouldShowAccountHealthBadge(null)).toBe(false);
    expect(shouldShowAccountHealthBadge("watch")).toBe(true);
    expect(shouldShowAccountHealthBadge("critical")).toBe(true);
  });
});

describe("Accounts list UI labels", () => {
  it("renders After pending as an explicit secondary label", () => {
    expect(rowSource).toMatch(/After pending/);
    expect(rowSource).toMatch(/primary\.afterPending/);
    expect(detailSource).toMatch(/After pending/);
    expect(detailSource).toMatch(/Current balance|primaryLabel/);
  });
});

describe("Account Detail cache reuse", () => {
  it("seeds detail from list cache and skips forecast when enrichment already present", () => {
    expect(detailSource).toMatch(/seedAccountFromListCache/);
    expect(detailSource).toMatch(/resolveBalanceDetailInitialData/);
    expect(detailSource).toMatch(/initialData: balanceInitial\.data/);
    expect(detailSource).toMatch(/initialDataUpdatedAt: balanceInitial\.updatedAt/);
    expect(detailSource).not.toMatch(/seedBalanceDetailFromListCache/);
    expect(detailSource).toMatch(/accountHasForecastEnrichment/);
    expect(detailSource).toMatch(/enabled: needsForecastFetch/);
    expect(accountHasForecastEnrichment(
      cashAccount({ forecast_summary: { current_balance: "1" }, available_to_spend: "1" })
    )).toBe(true);
    expect(accountHasForecastEnrichment(cashAccount())).toBe(false);
    expect(typeof seedAccountFromListCache).toBe("function");
  });

  it("derives balanceDetail initialData from fresh main list without arbitrary updatedAt", () => {
    const queryClient = new QueryClient();
    const account = cashAccount({ id: 7 });
    const mainUpdatedAt = 800_000;
    queryClient.setQueryData(accountQueryKeys.mainList(), {
      count: 1,
      next: null,
      previous: null,
      results: [account],
    } satisfies PaginatedResponse<Account>, { updatedAt: mainUpdatedAt });

    const initial = resolveBalanceDetailInitialData(queryClient, 7, 30);
    expect(initial.data).toEqual(account);
    expect(initial.updatedAt).toBe(mainUpdatedAt);
  });

  it("gates list enrichment behind main success with cache escape hatch", () => {
    expect(listHookSource).toMatch(/accountsListEnrichmentEnabled/);
    expect(listHookSource).toMatch(/mainListSuccess: mainQuery\.isSuccess/);
    expect(listHookSource).not.toMatch(/enabled: forecastReady,/);
  });
});

describe("Account Detail upcoming preview", () => {
  it("uses canonical timeline query shared with Transactions", () => {
    expect(detailSource).toMatch(/defaultLedgerTimelineQueryOptions/);
    expect(detailSource).toMatch(/accountDetailUpcomingPreviewRows/);
    expect(detailSource).not.toMatch(/date_after: today/);
    expect(detailSource).toMatch(/timelineRow=\{row\}/);
  });

  it("does not recompute projected balances in the preview UI", () => {
    expect(detailSource).not.toMatch(/runningBalance=/);
    expect(detailSource).not.toMatch(/timelineRowLedgerBalance/);
  });
});
