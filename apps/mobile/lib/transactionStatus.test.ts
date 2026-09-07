import { describe, expect, it } from "vitest";
import type { Transaction } from "@budget-app/shared";
import {
  canChangeTransactionCategory,
  canDeleteTransaction,
  isBankImportedTransaction,
  resolveTransactionDetailBadges,
} from "@/lib/transactionStatus";

describe("canDeleteTransaction", () => {
  it("blocks bank imports and reconciled rows", () => {
    expect(isBankImportedTransaction({ plaid_transaction_id: "x", source: "ACTUAL" })).toBe(true);
    expect(canDeleteTransaction({ plaid_transaction_id: "x", source: "ACTUAL" })).toBe(false);
    expect(canDeleteTransaction({ source: "PLAID" })).toBe(false);
    expect(canDeleteTransaction({ reconciled: true, source: "ACTUAL" })).toBe(false);
    expect(canDeleteTransaction({ source: "ACTUAL" })).toBe(true);
  });
});

describe("canChangeTransactionCategory", () => {
  it("allows imports but not reconciled rows", () => {
    expect(canChangeTransactionCategory({ reconciled: false })).toBe(true);
    expect(canChangeTransactionCategory({ reconciled: true })).toBe(false);
  });
});

const txn = (partial: Partial<Transaction> & Pick<Transaction, "id">): Transaction =>
  ({
    payee: "Test",
    amount: "-10.00",
    date: "2026-09-10",
    direction: "OUTFLOW",
    cleared: false,
    reconciled: false,
    memo: "",
    tags: [],
    account: { id: 1, name: "Main" } as Transaction["account"],
    category: null,
    ...partial,
  }) as Transaction;

describe("resolveTransactionDetailBadges", () => {
  it("does not label a future scheduled occurrence as bank Pending", () => {
    const badges = resolveTransactionDetailBadges(
      txn({ id: 1, status: "PLANNED", source: "RULE", rule_id: 4, date: "2026-09-20" }),
      "2026-09-06"
    );
    expect(badges.map((b) => b.label)).toEqual(["Forecast"]);
    expect(badges.some((b) => b.label === "Pending")).toBe(false);
  });

  it("labels uncleared posted bank rows as Pending settlement", () => {
    const badges = resolveTransactionDetailBadges(
      txn({
        id: 2,
        status: "CLEARED",
        source: "PLAID",
        plaid_transaction_id: "p1",
        cleared: false,
        date: "2026-09-04",
      }),
      "2026-09-06"
    );
    expect(badges.map((b) => b.label)).toEqual(["Pending"]);
  });

  it("uses compact Matched + Cleared for a matched bank transaction", () => {
    const badges = resolveTransactionDetailBadges(
      txn({
        id: 3,
        status: "CLEARED",
        source: "PLAID",
        plaid_transaction_id: "p2",
        import_match_status: "matched",
        cleared: true,
        date: "2026-09-04",
      }),
      "2026-09-06"
    );
    expect(badges.map((b) => b.label)).toEqual(["Matched", "Cleared"]);
    expect(badges.some((b) => b.label === "Imported")).toBe(false);
    expect(badges.some((b) => b.label === "Matched to bank import")).toBe(false);
  });

  it("labels future manual scheduled rows as Future, not Pending", () => {
    const badges = resolveTransactionDetailBadges(
      txn({ id: 4, status: "PLANNED", source: "ONE_TIME", date: "2026-09-20" }),
      "2026-09-06"
    );
    expect(badges.map((b) => b.label)).toEqual(["Future"]);
  });
});
