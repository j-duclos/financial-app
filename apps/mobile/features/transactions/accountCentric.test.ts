import { describe, expect, it, beforeEach } from "vitest";
import type { Account, Transaction } from "@budget-app/shared";
import {
  firstCanonicalActiveAccountId,
  parseRouteAccountId,
  resolveInitialTransactionAccount,
} from "@/features/transactions/accountSelection";
import {
  clearLastViewedTransactionAccountId,
  getLastViewedTransactionAccountId,
  setLastViewedTransactionAccountId,
} from "@/features/transactions/transactionsSession";
import { transactionTransferSubtitle } from "@/features/transactions/transferDisplay";
import { isTransferTransaction } from "@/lib/transactionStatus";

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

describe("parseRouteAccountId", () => {
  it("parses valid route account ids", () => {
    expect(parseRouteAccountId("42")).toBe(42);
  });

  it("ignores invalid route account ids", () => {
    expect(parseRouteAccountId("abc")).toBeNull();
    expect(parseRouteAccountId(undefined)).toBeNull();
  });
});

describe("resolveInitialTransactionAccount", () => {
  const accounts = [
    account({ id: 1, account_type: "CHECKING", name: "Main" }),
    account({ id: 2, account_type: "CREDIT", name: "Care Credit" }),
  ];

  beforeEach(() => {
    clearLastViewedTransactionAccountId();
  });

  it("prefers route account id", () => {
    setLastViewedTransactionAccountId(2);
    expect(
      resolveInitialTransactionAccount({
        routeAccountId: 1,
        defaultAccountId: 2,
        accounts,
      })
    ).toBe(1);
  });

  it("falls back to session account", () => {
    setLastViewedTransactionAccountId(2);
    expect(
      resolveInitialTransactionAccount({
        routeAccountId: null,
        defaultAccountId: 1,
        accounts,
      })
    ).toBe(2);
  });

  it("falls back to profile default account", () => {
    expect(
      resolveInitialTransactionAccount({
        routeAccountId: null,
        defaultAccountId: 2,
        accounts,
      })
    ).toBe(2);
  });

  it("falls back to first canonical active account", () => {
    expect(
      resolveInitialTransactionAccount({
        routeAccountId: null,
        defaultAccountId: null,
        accounts,
      })
    ).toBe(1);
  });
});

describe("firstCanonicalActiveAccountId", () => {
  it("returns checking before credit", () => {
    const id = firstCanonicalActiveAccountId([
      account({ id: 9, account_type: "CREDIT", name: "Card" }),
      account({ id: 3, account_type: "CHECKING", name: "Main" }),
    ]);
    expect(id).toBe(3);
  });
});

describe("transaction session", () => {
  beforeEach(() => {
    clearLastViewedTransactionAccountId();
  });

  it("stores last viewed account in session", () => {
    expect(getLastViewedTransactionAccountId()).toBeNull();
    setLastViewedTransactionAccountId(5);
    expect(getLastViewedTransactionAccountId()).toBe(5);
  });
});

describe("transactionTransferSubtitle", () => {
  const transferTxn = (partial: Partial<Transaction>): Transaction =>
    ({
      id: 1,
      date: "2026-08-27",
      payee: "Move to Savings",
      memo: "",
      amount: "-497.00",
      direction: "OUTFLOW",
      cleared: true,
      reconciled: false,
      tags: [],
      account: account({ id: 1, account_type: "CHECKING", name: "Main" }),
      category: { id: 1, name: "Transfer" } as Transaction["category"],
      transfer_to_account: account({ id: 2, account_type: "SAVINGS", name: "Savings" }),
      ...partial,
    }) as Transaction;

  it("shows transfer to counterparty on outflow leg", () => {
    const txn = transferTxn({ direction: "OUTFLOW", amount: "-497.00" });
    expect(isTransferTransaction(txn)).toBe(true);
    expect(transactionTransferSubtitle(txn)).toBe("Transfer to Savings");
  });

  it("shows transfer from counterparty on inflow leg", () => {
    const txn = transferTxn({
      direction: "INFLOW",
      amount: "497.00",
      account: account({ id: 2, account_type: "SAVINGS", name: "Savings" }),
      transfer_to_account: account({ id: 1, account_type: "CHECKING", name: "Main" }),
    });
    expect(transactionTransferSubtitle(txn)).toBe("Transfer from Main");
  });
});
