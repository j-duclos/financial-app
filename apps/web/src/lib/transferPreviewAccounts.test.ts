import { describe, expect, it } from "vitest";
import type { Account } from "@budget-app/shared";
import {
  transferPreviewAccountIds,
  transferPreviewAmountPayload,
  transferPreviewAmountReady,
  destinationCardOwedAmount,
  projectedCardOwedFromPreview,
} from "./transferPreviewAccounts";

function creditCard(overrides: Partial<Account> = {}): Account {
  return {
    id: 33,
    household: { id: 1, name: "Home", created_at: "", updated_at: "" },
    account_type: "CREDIT",
    role: "other",
    name: "Venture",
    institution: "Capital One",
    currency: "USD",
    is_active: true,
    created_at: "",
    updated_at: "",
    ...overrides,
  } as Account;
}

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

describe("destinationCardOwedAmount", () => {
  it("shows preview owed including zero instead of a missing dash", () => {
    expect(
      destinationCardOwedAmount({
        previewOwedBefore: "412.18",
        destinationAccount: null,
      })
    ).toBe(412.18);
    expect(
      destinationCardOwedAmount({
        previewOwedBefore: "0.00",
        destinationAccount: null,
      })
    ).toBe(0);
  });

  it("prefers preview owed over the selected card's stored balance", () => {
    expect(
      destinationCardOwedAmount({
        previewOwedBefore: "90.00",
        destinationAccount: creditCard({ balance_owed: "1883.44" }),
      })
    ).toBe(90);
  });

  it("uses the selected card's API owed amount when preview has not returned", () => {
    expect(
      destinationCardOwedAmount({
        destinationAccount: creditCard({ balance_owed: "1883.44" }),
      })
    ).toBe(1883.44);
  });

  it("uses current_balance and signed starting_balance when owed is omitted", () => {
    expect(
      destinationCardOwedAmount({
        destinationAccount: creditCard({ current_balance: "412.00" }),
      })
    ).toBe(412);
    expect(
      destinationCardOwedAmount({
        destinationAccount: creditCard({ starting_balance: "-250.00" }),
      })
    ).toBe(250);
  });
});

describe("projectedCardOwedFromPreview", () => {
  it("does not use the selected card's current or starting balance", () => {
    expect(
      projectedCardOwedFromPreview({
        previewOwedBefore: null,
        previewDestSignedBefore: null,
      })
    ).toBeNull();
    expect(
      projectedCardOwedFromPreview({
        previewOwedBefore: "90.00",
      })
    ).toBe(90);
  });
});
