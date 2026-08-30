import { describe, expect, it } from "vitest";
import {
  canSelectTransactionForBatchDelete,
  type TransactionRowData,
} from "./TransactionRow";

const baseRow = (partial: Partial<TransactionRowData>): TransactionRowData => ({
  id: "test-row",
  date: "2026-08-28",
  payee: "Test",
  category: "Groceries",
  amount: -25,
  balance: 100,
  isOutflow: true,
  source: { source: "actual", rule_id: null },
  reconciled: false,
  txnSource: "ACTUAL",
  importMatchStatus: null,
  plaidTransactionId: null,
  transactionId: 42,
  accountId: 1,
  linkedTransactionId: null,
  hasTransferDestination: false,
  readOnly: false,
  plannedScheduled: false,
  ...partial,
});

describe("canSelectTransactionForBatchDelete", () => {
  it("allows posted manual deletable rows", () => {
    expect(canSelectTransactionForBatchDelete(baseRow({}))).toBe(true);
  });

  it("blocks planned expected rows even when they have a transaction id", () => {
    expect(
      canSelectTransactionForBatchDelete(
        baseRow({
          plannedScheduled: true,
          source: { source: "rule", rule_id: 7 },
          txnSource: "RULE",
        })
      )
    ).toBe(false);
  });

  it("blocks projection-only rule rows without a transaction id", () => {
    expect(
      canSelectTransactionForBatchDelete(
        baseRow({
          transactionId: null,
          source: { source: "rule", rule_id: 7 },
        })
      )
    ).toBe(false);
  });

  it("blocks reconciled, imported, and read-only rows", () => {
    expect(canSelectTransactionForBatchDelete(baseRow({ reconciled: true }))).toBe(false);
    expect(canSelectTransactionForBatchDelete(baseRow({ txnSource: "PLAID" }))).toBe(false);
    expect(canSelectTransactionForBatchDelete(baseRow({ plaidTransactionId: "abc" }))).toBe(false);
    expect(canSelectTransactionForBatchDelete(baseRow({ readOnly: true }))).toBe(false);
  });
});

describe("timeline row data wiring", () => {
  it("marks planned scheduled timeline rows as not batch-deletable", async () => {
    const { timelineRowToData } = await import("./TransactionRow");
    const data = timelineRowToData(
      {
        date: "2026-08-28",
        description: "Rent",
        amount: "-1200.00",
        type: "EXPENSE",
        account_id: 1,
        status: "PLANNED",
        source: "rule",
        rule_id: 9,
        txn_source: "RULE",
      } as never,
      500,
      "expected"
    );
    expect(data.plannedScheduled).toBe(true);
    expect(canSelectTransactionForBatchDelete(data)).toBe(false);
  });

  it("marks cleared manual rows as batch-deletable", async () => {
    const { timelineRowToData } = await import("./TransactionRow");
    const data = timelineRowToData(
      {
        date: "2026-08-20",
        description: "Coffee",
        amount: "-4.50",
        type: "EXPENSE",
        account_id: 1,
        status: "CLEARED",
        source: "actual",
        transaction_id: 99,
        txn_source: "ACTUAL",
      } as never,
      100,
      "past"
    );
    expect(data.plannedScheduled).toBe(false);
    expect(canSelectTransactionForBatchDelete(data)).toBe(true);
  });
});
