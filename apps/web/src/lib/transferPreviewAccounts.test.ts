import { describe, expect, it } from "vitest";
import {
  transferPreviewAccountIds,
  transferPreviewAmountPayload,
  transferPreviewAmountReady,
} from "./transferPreviewAccounts";

describe("transferPreviewAccountIds", () => {
  it("keeps a credit-card Payment to destination even when amount is empty or zero", () => {
    const ledger = 11;
    const card = 33;
    expect(
      transferPreviewAccountIds({
        ledgerAccountId: ledger,
        counterpartyAccountId: card,
        amount: "",
        creditCardPayment: true,
      })
    ).toEqual({ fromAccountId: ledger, toAccountId: card });
    expect(
      transferPreviewAccountIds({
        ledgerAccountId: ledger,
        counterpartyAccountId: card,
        amount: "0.00",
        creditCardPayment: true,
      })
    ).toEqual({ fromAccountId: ledger, toAccountId: card });
    expect(
      transferPreviewAccountIds({
        ledgerAccountId: ledger,
        counterpartyAccountId: card,
        amount: "300",
        creditCardPayment: true,
      })
    ).toEqual({ fromAccountId: ledger, toAccountId: card });
  });

  it("does not treat the selected card as the source when amount is not an outflow yet", () => {
    const ids = transferPreviewAccountIds({
      ledgerAccountId: 11,
      counterpartyAccountId: 33,
      amount: "",
      creditCardPayment: true,
    });
    expect(ids.fromAccountId).not.toBe(33);
    expect(ids.toAccountId).toBe(33);
  });

  it("still swaps bank-transfer legs when the signed amount is an inflow", () => {
    expect(
      transferPreviewAccountIds({
        ledgerAccountId: 11,
        counterpartyAccountId: 22,
        amount: "50",
        creditCardPayment: false,
      })
    ).toEqual({ fromAccountId: 22, toAccountId: 11 });
    expect(
      transferPreviewAccountIds({
        ledgerAccountId: 11,
        counterpartyAccountId: 22,
        amount: "-50",
        creditCardPayment: false,
      })
    ).toEqual({ fromAccountId: 11, toAccountId: 22 });
  });
});

describe("transferPreviewAmountReady", () => {
  it("allows empty or zero so destination owed can load before an amount is typed", () => {
    expect(transferPreviewAmountReady("")).toBe(true);
    expect(transferPreviewAmountReady("0")).toBe(true);
    expect(transferPreviewAmountReady("0.00")).toBe(true);
    expect(transferPreviewAmountReady("-300")).toBe(true);
    expect(transferPreviewAmountReady("abc")).toBe(false);
    expect(transferPreviewAmountPayload("")).toBe("0");
  });
});
