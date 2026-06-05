import { describe, expect, it } from "vitest";
import { resolveTransactionKind } from "./transactionKindUtils";

describe("resolveTransactionKind", () => {
  it("returns Card Payment for credit card payment category", () => {
    expect(resolveTransactionKind({ category_name: "Credit Card Payment" })).toBe("Card Payment");
  });

  it("returns Transfer for transfer-like rows", () => {
    expect(resolveTransactionKind({ category_name: "Bank Transfer" })).toBe("Transfer");
    expect(resolveTransactionKind({ type: "TRANSFER" })).toBe("Transfer");
  });

  it("returns Income for inflows", () => {
    expect(resolveTransactionKind({ type: "INFLOW" })).toBe("Income");
    expect(resolveTransactionKind({ direction: "INFLOW" })).toBe("Income");
  });

  it("returns Transfer for linked inflows", () => {
    expect(resolveTransactionKind({ type: "INFLOW", linked_transaction_id: 42 })).toBe("Transfer");
    expect(resolveTransactionKind({ type: "INFLOW", has_transfer_destination: true })).toBe(
      "Transfer"
    );
  });

  it("returns Expense by default", () => {
    expect(resolveTransactionKind({ type: "OUTFLOW" })).toBe("Expense");
    expect(resolveTransactionKind({})).toBe("Expense");
  });
});
