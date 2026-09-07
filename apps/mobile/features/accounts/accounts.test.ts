import { describe, expect, it } from "vitest";
import type { Account } from "@budget-app/shared";
import { groupAccountsByType } from "@/lib/accountGroups";
import { countActiveTransactionFilters, DEFAULT_TRANSACTION_FILTERS } from "@/features/transactions/types";
import { resolveListPrimaryBalance } from "./accountBalanceDisplay";

const account = (partial: Partial<Account> & Pick<Account, "id" | "account_type" | "name">): Account =>
  ({
    household: { id: 1, name: "Home" } as Account["household"],
    role: "spending",
    institution: "Bank",
    currency: "USD",
    is_active: true,
    created_at: "",
    updated_at: "",
    ...partial,
  }) as Account;

describe("groupAccountsByType", () => {
  it("groups Checking, Savings, and Credit in canonical order", () => {
    const groups = groupAccountsByType([
      account({ id: 1, account_type: "CREDIT", name: "Card" }),
      account({ id: 2, account_type: "SAVINGS", name: "Rainy" }),
      account({ id: 3, account_type: "CHECKING", name: "Checking" }),
    ]);
    expect(groups.map((g) => g.key)).toEqual(["CHECKING", "SAVINGS", "CREDIT"]);
    expect(groups.map((g) => g.label)).toEqual(["Checking", "Savings", "Credit"]);
  });
});

describe("list primary balances", () => {
  it("renders cash Current from posted/ledger fields", () => {
    expect(
      resolveListPrimaryBalance(
        account({
          id: 2,
          account_type: "CHECKING",
          name: "Checking",
          available_balance: "40.15",
          forecast_summary: { current_balance: "40.15" },
        })
      )
    ).toEqual({ label: "Current", amount: "40.15", afterPending: null });
  });

  it("renders credit Owed from balance_owed", () => {
    expect(
      resolveListPrimaryBalance(
        account({
          id: 1,
          account_type: "CREDIT",
          name: "Card",
          balance_owed: "926.24",
        })
      )
    ).toEqual({ label: "Owed", amount: "926.24", afterPending: null });
  });
});

describe("transaction filters", () => {
  it("counts active filters excluding account selection and search text", () => {
    expect(countActiveTransactionFilters(DEFAULT_TRANSACTION_FILTERS)).toBe(0);
    expect(
      countActiveTransactionFilters({
        ...DEFAULT_TRANSACTION_FILTERS,
        accountId: 3,
        showReconciled: true,
      })
    ).toBe(1);
  });
});
