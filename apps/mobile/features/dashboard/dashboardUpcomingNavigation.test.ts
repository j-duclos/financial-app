import { describe, expect, it } from "vitest";
import type { DashboardUpcomingTransaction } from "@budget-app/shared";
import {
  upcomingLedgerFocusTransactionId,
  upcomingTransactionNavTarget,
} from "@budget-app/shared";
import { upcomingMoneyFlowRowDestination } from "./navigation";
import { transactionsForLedgerFocusPath } from "@/features/payment-planner/navigation";

function txn(overrides: Partial<DashboardUpcomingTransaction> = {}): DashboardUpcomingTransaction {
  return {
    id: "42",
    date: "2026-09-02",
    account_id: 1,
    account_name: "Main",
    description: "Exeterfina Loan",
    amount: "-393.79",
    kind: "bill",
    category: null,
    balance_after: "-378.80",
    is_transfer: false,
    is_internal_transfer: false,
    is_credit_card_payment: false,
    source: "rule",
    status: "PLANNED",
    risk_flag: false,
    ...overrides,
  };
}

describe("Upcoming Money Flow row navigation", () => {
  it("routes ordinary rows to Transactions with ledger focus, not Calendar", () => {
    const target = upcomingTransactionNavTarget(txn({ id: "99", transaction_id: 99 }));
    expect(target.type).toBe("ledger");
    expect(target).toEqual({
      type: "ledger",
      accountId: 1,
      accountName: "Main",
      focusDate: "2026-09-02",
      focusTransactionId: 99,
      focusRuleId: null,
      focusEventId: "99",
    });
    expect(upcomingMoneyFlowRowDestination(txn({ id: "99", transaction_id: 99 }))).toEqual(
      transactionsForLedgerFocusPath({
        accountId: 1,
        accountName: "Main",
        focus: "ledger-event",
        focusDate: "2026-09-02",
        focusTransactionId: 99,
        focusRuleId: null,
        focusEventId: "99",
      })
    );
  });

  it("focuses collapsed transfer rows on the source-account leg", () => {
    const negative = txn({
      id: "out",
      account_id: 1,
      account_name: "Main",
      amount: "-497.00",
      transaction_id: 501,
      rule_id: 10,
      is_transfer: true,
      is_internal_transfer: true,
      transfer_from_account_name: "Main",
      transfer_to_account_name: "Savings",
    });
    const positive = txn({
      id: "in",
      account_id: 2,
      account_name: "Savings",
      amount: "497.00",
      transaction_id: 502,
      is_transfer: true,
      is_internal_transfer: true,
      transfer_from_account_name: "Main",
      transfer_to_account_name: "Savings",
    });
    const collapsed = {
      ...negative,
      id: "xfer-out-in",
      amount: "497.00",
      transaction_id: 501,
      rule_id: 10,
      transfer_from_balance_after: "78.64",
      transfer_to_balance_after: "2728.64",
    };
    expect(upcomingLedgerFocusTransactionId(collapsed)).toBe(501);
    const dest = upcomingMoneyFlowRowDestination(collapsed);
    expect(dest.params.account).toBe("1");
    expect(dest.params.focus).toBe("ledger-event");
    expect(dest.params.focusTransactionId).toBe("501");
  });

  it("falls back to rule id and date when no persisted transaction id exists", () => {
    const target = upcomingTransactionNavTarget(
      txn({
        id: "2026-09-02-1-r-5-0",
        transaction_id: null,
        rule_id: 5,
      })
    );
    expect(target.focusTransactionId).toBeNull();
    expect(target.focusRuleId).toBe(5);
    expect(upcomingMoneyFlowRowDestination(txn({ id: "evt", rule_id: 5 })).params.focusRuleId).toBe(
      "5"
    );
  });
});
