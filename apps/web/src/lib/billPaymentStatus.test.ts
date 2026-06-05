import { describe, expect, it } from "vitest";
import type { BillChecklistItem, TimelineCalendarTransaction } from "@budget-app/shared";
import { paymentHistoryStatusLabel, resolveBillPaymentStatus } from "./billPaymentStatus";

const TODAY = "2025-06-10";

function txn(overrides: Partial<TimelineCalendarTransaction> = {}): TimelineCalendarTransaction {
  return {
    id: "r-42-2025-06-17",
    description: "Netflix",
    account_name: "Main",
    amount: "-15.99",
    category: "Subscriptions",
    kind: "bill",
    source: "rule",
    status: "planned",
    rule_id: 42,
    transaction_id: null,
    balance_after: "100",
    is_transfer: false,
    ...overrides,
  };
}

function occurrence(status: BillChecklistItem["status"]): BillChecklistItem {
  return {
    id: 1,
    name: "Netflix",
    account: { id: 1, name: "Main" },
    due_date: "2025-06-17",
    amount: "15.99",
    category: null,
    source_type: "rule",
    transaction_id: null,
    rule_id: 42,
    status,
    paid_date: null,
    matched_transaction_id: null,
    is_overdue: false,
    days_until_due: 7,
    skipped: false,
    notes: "",
  };
}

describe("resolveBillPaymentStatus", () => {
  it("shows scheduled for future rule-projected bills", () => {
    expect(
      resolveBillPaymentStatus({
        dueDate: "2025-06-17",
        txn: txn(),
        todayIso: TODAY,
      })
    ).toBe("projected");
  });

  it("shows due soon within window", () => {
    expect(
      resolveBillPaymentStatus({
        dueDate: "2025-06-12",
        txn: txn({ id: "r-42-2025-06-12", source: "rule", status: "planned" }),
        todayIso: TODAY,
      })
    ).toBe("due_soon");
  });

  it("shows late for past unpaid projected bills", () => {
    expect(
      resolveBillPaymentStatus({
        dueDate: "2025-06-01",
        txn: txn({ id: "r-42-2025-06-01" }),
        todayIso: TODAY,
      })
    ).toBe("late");
  });

  it("does not mark future actual rows as paid", () => {
    expect(
      resolveBillPaymentStatus({
        dueDate: "2025-06-17",
        txn: txn({
          id: 99,
          source: "actual",
          status: "CLEARED",
          transaction_id: 99,
          rule_id: 42,
        }),
        todayIso: TODAY,
      })
    ).toBe("projected");
  });

  it("shows paid for past cleared transactions", () => {
    expect(
      resolveBillPaymentStatus({
        dueDate: "2025-06-01",
        txn: txn({
          id: 10,
          source: "actual",
          status: "CLEARED",
          transaction_id: 10,
          cleared: true,
        }),
        todayIso: TODAY,
      })
    ).toBe("paid");
  });

  it("shows reconciled when occurrence is reconciled", () => {
    expect(
      resolveBillPaymentStatus({
        dueDate: "2025-06-01",
        txn: txn({ id: 10, source: "actual", status: "RECONCILED", transaction_id: 10 }),
        occurrence: occurrence("reconciled"),
        todayIso: TODAY,
      })
    ).toBe("reconciled");
  });

  it("prefers checklist occurrence status from bills API", () => {
    expect(
      resolveBillPaymentStatus({
        dueDate: "2025-06-17",
        txn: txn({ source: "actual", status: "CLEARED", transaction_id: 5 }),
        occurrence: occurrence("projected"),
        todayIso: TODAY,
      })
    ).toBe("projected");
  });
});

describe("paymentHistoryStatusLabel", () => {
  it("labels future rows as planned", () => {
    expect(
      paymentHistoryStatusLabel({ date: "2025-12-01", status: "planned" }, TODAY)
    ).toBe("Planned");
  });

  it("labels past cleared as paid", () => {
    expect(
      paymentHistoryStatusLabel({ date: "2025-05-01", status: "CLEARED" }, TODAY)
    ).toBe("Paid");
  });
});
