import { describe, expect, it } from "vitest";
import {
  completeDisabledReason,
  formatSignedCurrency,
  isReconcileBalanced,
  selectedCountLabel,
} from "./reconcileWorkflow";

describe("completeDisabledReason", () => {
  it("asks for a bank balance before any difference exists", () => {
    expect(completeDisabledReason({ hasBankBalance: false, differenceCents: null })).toBe(
      "Enter bank balance to begin."
    );
  });

  it("requires a $0.00 difference before complete", () => {
    expect(completeDisabledReason({ hasBankBalance: true, differenceCents: 649 })).toBe(
      "Difference must be $0.00 before reconciliation can be completed."
    );
  });

  it("returns null when balanced within one cent", () => {
    expect(completeDisabledReason({ hasBankBalance: true, differenceCents: 0 })).toBeNull();
    expect(completeDisabledReason({ hasBankBalance: true, differenceCents: 1 })).toBeNull();
  });
});

describe("selectedCountLabel", () => {
  it("describes partial and full selection", () => {
    expect(selectedCountLabel(65, 67)).toBe("65 of 67 transactions selected");
    expect(selectedCountLabel(67, 67)).toBe("67 of 67 transactions selected");
    expect(selectedCountLabel(1, 1)).toBe("1 of 1 transaction selected");
  });
});

describe("isReconcileBalanced", () => {
  it("treats a one-cent gap as balanced to match backend tolerance", () => {
    expect(isReconcileBalanced(0)).toBe(true);
    expect(isReconcileBalanced(1)).toBe(true);
    expect(isReconcileBalanced(2)).toBe(false);
    expect(isReconcileBalanced(null)).toBe(false);
  });
});

describe("formatSignedCurrency", () => {
  it("prefixes selected activity", () => {
    expect(formatSignedCurrency(107669)).toMatch(/^\+/);
    expect(formatSignedCurrency(-7099)).toMatch(/^-/);
  });
});
