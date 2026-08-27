import { describe, expect, it } from "vitest";
import {
  canChangeTransactionCategory,
  canDeleteTransaction,
  isBankImportedTransaction,
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
