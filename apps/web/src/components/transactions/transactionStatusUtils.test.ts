import { describe, expect, it } from "vitest";
import { resolveTransactionStatusIcons } from "./transactionStatusUtils";

describe("resolveTransactionStatusIcons", () => {
  it("shows reconciled plus plaid for imported rows", () => {
    expect(
      resolveTransactionStatusIcons({
        reconciled: true,
        txnSource: "plaid",
        transactionId: 1,
      })
    ).toEqual(["reconciled", "plaid"]);
  });

  it("shows rule when rule_id is set", () => {
    expect(
      resolveTransactionStatusIcons({
        ruleId: 12,
        ledgerSource: "actual",
        transactionId: 5,
      })
    ).toEqual(["rule"]);
  });

  it("shows rule for one-time planned source", () => {
    expect(
      resolveTransactionStatusIcons({
        txnSource: "ONE_TIME",
        transactionId: 5,
      })
    ).toEqual(["rule"]);
  });

  it("shows manual for actual transactions without rule or plaid", () => {
    expect(
      resolveTransactionStatusIcons({
        txnSource: "actual",
        ledgerSource: "actual",
        transactionId: 3,
      })
    ).toEqual(["manual"]);
  });

  it("shows imported icon when manual row is matched to bank", () => {
    expect(
      resolveTransactionStatusIcons({
        txnSource: "actual",
        importMatchStatus: "matched",
        transactionId: 3,
      })
    ).toEqual(["plaid"]);
  });

  it("skips origin icons for projected interest", () => {
    expect(
      resolveTransactionStatusIcons({
        ledgerSource: "interest",
        readOnly: true,
      })
    ).toEqual([]);
  });

  it("still shows origin icons when readOnly is set on non-interest rows", () => {
    expect(
      resolveTransactionStatusIcons({
        reconciled: true,
        readOnly: true,
        txnSource: "plaid",
        transactionId: 1,
      })
    ).toEqual(["reconciled", "plaid"]);
  });

  it("shows transfer for credit card payment category", () => {
    expect(
      resolveTransactionStatusIcons({
        txnSource: "actual",
        ledgerSource: "actual",
        transactionId: 8,
        category_name: "Credit Card Payment",
      })
    ).toEqual(["transfer"]);
  });

  it("prefers rule over transfer when rule_id is set", () => {
    expect(
      resolveTransactionStatusIcons({
        ruleId: 3,
        category_name: "Credit Card Payment",
        transactionId: 9,
      })
    ).toEqual(["rule"]);
  });
});
