import { describe, it, expect } from "vitest";
import type { Transaction } from "@budget-app/shared";
import type { LedgerRow } from "./transactionsLedgerUtils";
import {
  filterLedgerPastRows,
  hasActiveLedgerRowFilters,
  ledgerRowAbsAmount,
  matchesLedgerRowFilters,
  parseAmountFilterInput,
} from "./ledgerRowFilters";

const expenseTxn: Transaction = {
  id: 1,
  date: "2026-01-01",
  payee: "Gas",
  amount: "-20.00",
  direction: "OUTFLOW",
  account: 1,
  category: { id: 1, name: "Auto", household: 1 },
  source: "actual",
  reconciled: false,
};

const incomeTxn: Transaction = {
  ...expenseTxn,
  id: 2,
  payee: "Paycheck",
  amount: "200.00",
  direction: "INFLOW",
  category: { id: 2, name: "Salary", household: 1 },
};

function txnRow(txn: Transaction, balance = 100): LedgerRow {
  return { type: "transaction", txn, balance };
}

describe("ledgerRowFilters", () => {
  it("parses amount filter input", () => {
    expect(parseAmountFilterInput("")).toBeNull();
    expect(parseAmountFilterInput("  ")).toBeNull();
    expect(parseAmountFilterInput("$50.25")).toBe(50.25);
    expect(parseAmountFilterInput("abc")).toBeNull();
  });

  it("resolves absolute amount from ledger rows", () => {
    expect(ledgerRowAbsAmount(txnRow(expenseTxn))).toBe(20);
    expect(ledgerRowAbsAmount(txnRow(incomeTxn))).toBe(200);
  });

  it("filters by amount range", () => {
    const rows = [txnRow(expenseTxn), txnRow(incomeTxn)];
    const filters = {
      amountMin: 10,
      amountMax: 30,
    };

    expect(hasActiveLedgerRowFilters(filters)).toBe(true);
    expect(filterLedgerPastRows(rows, filters)).toEqual([txnRow(expenseTxn)]);
    expect(matchesLedgerRowFilters(txnRow(incomeTxn), filters)).toBe(false);
    expect(
      matchesLedgerRowFilters(txnRow(expenseTxn), {
        amountMin: 25,
        amountMax: null,
      })
    ).toBe(false);
  });

  it("filters upcoming recurring rows by amount without changing balances", () => {
    const row: LedgerRow = {
      type: "recurring",
      row: {
        date: "2026-09-01",
        description: "Rent",
        amount: "-1200.00",
        running_balance: "100",
        account_id: 1,
      } as never,
      balance: 100,
    };
    expect(
      matchesLedgerRowFilters(row, { amountMin: 500, amountMax: null })
    ).toBe(true);
    expect(
      matchesLedgerRowFilters(row, { amountMin: null, amountMax: 100 })
    ).toBe(false);
    expect(ledgerRowAbsAmount(row)).toBe(1200);
  });
});
