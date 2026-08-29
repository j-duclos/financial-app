import { describe, expect, it } from "vitest";
import type { Transaction, TimelineRow } from "@budget-app/shared";
import {
  getTransactionRowDestination,
  getTransactionRowDestinationFromTimelineRow,
  getTransactionRowDestinationFromTransaction,
  prefersDirectEditFromLedger,
  transactionRowDetailPath,
  transactionRowEditPath,
} from "./transactionRowNavigation";
import type { TransactionListRow } from "./buildTransactionList";

const txn = (partial: Partial<Transaction> & Pick<Transaction, "id">): Transaction =>
  ({
    payee: "Test",
    amount: "-10.00",
    date: "2026-08-28",
    direction: "OUTFLOW",
    cleared: false,
    reconciled: false,
    memo: "",
    tags: [],
    account: { id: 1, name: "Main" } as Transaction["account"],
    category: null,
    ...partial,
  }) as Transaction;

const timeline = (partial: Partial<TimelineRow> & Pick<TimelineRow, "date">): TimelineRow =>
  ({
    description: "Test",
    account_id: 1,
    account_name: "Main",
    category_id: null,
    category_name: "Utilities",
    amount: "-10.00",
    type: "expense",
    status: "PLANNED",
    source: "actual",
    rule_id: null,
    transaction_id: 99,
    running_balance: "100.00",
    ...partial,
  }) as TimelineRow;

describe("prefersDirectEditFromLedger", () => {
  it("manual ACTUAL transaction direct-edits", () => {
    expect(
      prefersDirectEditFromLedger(
        txn({ id: 1, status: "CLEARED", source: "ACTUAL", cleared: false })
      )
    ).toBe(true);
  });

  it("manual pending ACTUAL direct-edits", () => {
    expect(
      prefersDirectEditFromLedger(
        txn({ id: 2, status: "PLANNED", source: "ACTUAL", cleared: false })
      )
    ).toBe(true);
  });

  it("rule occurrence opens detail", () => {
    expect(
      prefersDirectEditFromLedger(
        txn({ id: 3, status: "PLANNED", source: "RULE", rule_id: 5 })
      )
    ).toBe(false);
  });

  it("imported transaction opens detail", () => {
    expect(
      prefersDirectEditFromLedger(
        txn({ id: 4, status: "CLEARED", source: "PLAID", plaid_transaction_id: "x" })
      )
    ).toBe(false);
  });

  it("reconciled transaction opens detail", () => {
    expect(
      prefersDirectEditFromLedger(txn({ id: 5, status: "CLEARED", source: "ACTUAL", reconciled: true }))
    ).toBe(false);
  });

  it("linked transfer opens detail", () => {
    expect(
      prefersDirectEditFromLedger(
        txn({
          id: 6,
          status: "CLEARED",
          source: "ACTUAL",
          linked_transaction_id: 7,
          category: { id: 1, name: "Bank Transfer" } as Transaction["category"],
        })
      )
    ).toBe(false);
  });
});

describe("getTransactionRowDestination", () => {
  it("manual editable history row → edit", () => {
    const dest = getTransactionRowDestinationFromTransaction(
      txn({ id: 10, status: "CLEARED", source: "ACTUAL" })
    );
    expect(dest).toEqual({ type: "edit", transactionId: 10 });
    expect(transactionRowEditPath(10)).toBe("/transaction/edit/10");
  });

  it("rule occurrence history row → detail", () => {
    const dest = getTransactionRowDestinationFromTransaction(
      txn({ id: 11, status: "PLANNED", source: "RULE", rule_id: 3 })
    );
    expect(dest).toEqual({ type: "detail", transactionId: 11 });
    expect(transactionRowDetailPath(11)).toBe("/transaction/11");
  });

  it("pending rule timeline row → detail", () => {
    const dest = getTransactionRowDestinationFromTimelineRow(
      timeline({ date: "2026-08-28", source: "rule", rule_id: 8, transaction_id: 12 })
    );
    expect(dest).toEqual({ type: "detail", transactionId: 12 });
  });

  it("pending manual timeline row → edit", () => {
    const dest = getTransactionRowDestinationFromTimelineRow(
      timeline({
        date: "2026-08-28",
        status: "PLANNED",
        source: "actual",
        txn_source: "ACTUAL",
        transaction_id: 13,
      })
    );
    expect(dest).toEqual({ type: "edit", transactionId: 13 });
  });

  it("one-time planned timeline row → edit", () => {
    const dest = getTransactionRowDestinationFromTimelineRow(
      timeline({
        date: "2026-09-01",
        status: "PLANNED",
        source: "actual",
        txn_source: "ONE_TIME",
        transaction_id: 14,
      })
    );
    expect(dest).toEqual({ type: "edit", transactionId: 14 });
  });

  it("list row wrapper uses resolver", () => {
    const row: TransactionListRow = {
      kind: "history",
      id: "history-20",
      txn: txn({ id: 20, status: "CLEARED", source: "ACTUAL" }),
      runningBalance: "100",
    };
    expect(getTransactionRowDestination(row)).toEqual({ type: "edit", transactionId: 20 });
  });
});
