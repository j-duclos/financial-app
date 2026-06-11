import { describe, it, expect } from "vitest";
import type { Transaction } from "@budget-app/shared";
import type { LedgerRow } from "./transactionsLedgerUtils";
import {
  filterLedgerPastRows,
  hasActiveLedgerRowFilters,
  ledgerRowAbsAmount,
  ledgerRowIsReconcilableTransaction,
  ledgerRowKind,
  ledgerRowReconciled,
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

  it("resolves kind and absolute amount from ledger rows", () => {
    expect(ledgerRowKind(txnRow(expenseTxn))).toBe("Expense");
    expect(ledgerRowKind(txnRow(incomeTxn))).toBe("Income");
    expect(ledgerRowAbsAmount(txnRow(expenseTxn))).toBe(20);
    expect(ledgerRowAbsAmount(txnRow(incomeTxn))).toBe(200);
  });

  it("filters by kind and amount range", () => {
    const rows = [txnRow(expenseTxn), txnRow(incomeTxn)];
    const filters = {
      kind: "Expense" as const,
      reconciled: "" as const,
      amountMin: 10,
      amountMax: 30,
    };

    expect(hasActiveLedgerRowFilters(filters)).toBe(true);
    expect(filterLedgerPastRows(rows, filters)).toEqual([txnRow(expenseTxn)]);
    expect(matchesLedgerRowFilters(txnRow(incomeTxn), filters)).toBe(false);
    expect(
      matchesLedgerRowFilters(txnRow(expenseTxn), {
        kind: "",
        reconciled: "",
        amountMin: 25,
        amountMax: null,
      })
    ).toBe(false);
  });

  it("filters by reconciled status", () => {
    const reconciledTxn = { ...expenseTxn, id: 3, reconciled: true };
    const plannedTxn = { ...expenseTxn, id: 4, status: "PLANNED", source: "rule" };
    const rows = [txnRow(expenseTxn), txnRow(reconciledTxn), txnRow(plannedTxn)];

    expect(
      filterLedgerPastRows(rows, {
        kind: "",
        reconciled: "reconciled",
        amountMin: null,
        amountMax: null,
      })
    ).toEqual([txnRow(reconciledTxn)]);

    expect(
      filterLedgerPastRows(rows, {
        kind: "",
        reconciled: "unreconciled",
        amountMin: null,
        amountMax: null,
      })
    ).toEqual([txnRow(expenseTxn)]);

    expect(ledgerRowIsReconcilableTransaction(txnRow(plannedTxn))).toBe(false);
    expect(ledgerRowReconciled(txnRow(plannedTxn))).toBeNull();
  });

  it("applies amount filters without blocking reconciled-only filters", () => {
    expect(
      matchesLedgerRowFilters(txnRow(expenseTxn), {
        kind: "",
        reconciled: "unreconciled",
        amountMin: null,
        amountMax: null,
      })
    ).toBe(true);
  });
});
