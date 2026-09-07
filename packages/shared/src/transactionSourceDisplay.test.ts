import { describe, expect, it } from "vitest";
import { transactionSourceDisplayLabel } from "./transactionSourceDisplay";

describe("transactionSourceDisplayLabel", () => {
  it("never shows raw ACTUAL or RULE enums", () => {
    expect(transactionSourceDisplayLabel({ source: "ACTUAL" })).toBe("Manual");
    expect(transactionSourceDisplayLabel({ source: "RULE" })).toBe("Recurring rule");
    expect(transactionSourceDisplayLabel({ source: "ACTUAL" })).not.toBe("ACTUAL");
    expect(transactionSourceDisplayLabel({ source: "RULE" })).not.toBe("RULE");
  });

  it("labels imported bank records as Bank transaction", () => {
    expect(transactionSourceDisplayLabel({ source: "PLAID" })).toBe("Bank transaction");
    expect(
      transactionSourceDisplayLabel({ source: "ACTUAL", plaid_transaction_id: "plaid-1" })
    ).toBe("Bank transaction");
  });

  it("maps remaining known sources to user-facing terms", () => {
    expect(transactionSourceDisplayLabel({ source: "ONE_TIME" })).toBe("Manual");
    expect(transactionSourceDisplayLabel({ source: "MANUAL" })).toBe("Manual");
    expect(transactionSourceDisplayLabel({ source: "INTEREST" })).toBe("Interest");
    expect(transactionSourceDisplayLabel({ source: "SYSTEM" })).toBe("System");
    expect(transactionSourceDisplayLabel({ source: null })).toBe("Manual");
  });
});
