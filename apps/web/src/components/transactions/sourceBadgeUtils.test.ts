import { describe, it, expect } from "vitest";
import { resolveTransactionSourceBadge } from "./sourceBadgeUtils";

describe("resolveTransactionSourceBadge", () => {
  it("returns Imported for plaid source", () => {
    expect(resolveTransactionSourceBadge({ source: "plaid" })).toBe("Imported");
  });

  it("returns Rule for rule source", () => {
    expect(resolveTransactionSourceBadge({ source: "rule", rule_id: 1 })).toBe("Rule");
  });

  it("returns Transfer for transfer categories", () => {
    expect(resolveTransactionSourceBadge({ category_name: "Credit Card Payment" })).toBe("Transfer");
  });

  it("returns Income for inflow types", () => {
    expect(resolveTransactionSourceBadge({ type: "INFLOW" })).toBe("Income");
  });

  it("returns Expense by default", () => {
    expect(resolveTransactionSourceBadge({ type: "OUTFLOW" })).toBe("Expense");
  });
});
