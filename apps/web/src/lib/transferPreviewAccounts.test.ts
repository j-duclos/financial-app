import { describe, expect, it } from "vitest";
import type { Account } from "@budget-app/shared";
import {
  transferPreviewAccountIds,
  transferPreviewAmountPayload,
  transferPreviewAmountReady,
  destinationCardOwedAmount,
  projectedCardOwedFromPreview,
  inlineBankDestLedgerPreview,
  previewBalancesForAccountId,
  accountLedgerBalanceToday,
  signedAmountForEditForm,
  directionFromSignedAmount,
  applyDirectionToSignedAmount,
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

  it("keeps an outflow bank transfer pointed at the selected dest even if amount is unsigned", () => {
    expect(
      transferPreviewAccountIds({
        ledgerAccountId: 11,
        counterpartyAccountId: 22,
        amount: "50",
        creditCardPayment: false,
        direction: "OUTFLOW",
      })
    ).toEqual({ fromAccountId: 11, toAccountId: 22 });
  });
});

describe("inlineBankDestLedgerPreview", () => {
  const savings = {
    id: 4,
    name: "Chase Savings",
    account_type: "SAVINGS",
    balance: "2231.64",
    starting_balance: "1860.07",
    current_balance: "3911.64",
  } as Account;

  it("uses today's ledger balance, not starting or a projected stand-in on current_balance", () => {
    expect(accountLedgerBalanceToday(savings)).toBe(2231.64);
    expect(
      inlineBankDestLedgerPreview({
        destinationAccount: savings,
        amount: "",
      })
    ).toEqual({ before: "2231.64", after: "2231.64" });
  });

  it("credits the dest when the open ledger amount is an outflow", () => {
    expect(
      inlineBankDestLedgerPreview({
        destinationAccount: savings,
        amount: "-100",
      })
    ).toEqual({ before: "2231.64", after: "2331.64" });
  });

  it("does not invent a balance from starting_balance", () => {
    expect(
      inlineBankDestLedgerPreview({
        destinationAccount: { ...savings, balance: undefined },
        amount: "0.00",
      })
    ).toBeNull();
  });
});

describe("previewBalancesForAccountId", () => {
  it("labels the selected dest with its own legs, not the source checking forecast", () => {
    expect(
      previewBalancesForAccountId({
        labeledAccountId: 4,
        fromAccountId: 1,
        toAccountId: 4,
        sourceBefore: "0.51",
        sourceAfter: "0.51",
        destBefore: "2231.64",
        destAfter: "2231.64",
      })
    ).toEqual({ before: "2231.64", after: "2231.64" });
    expect(
      previewBalancesForAccountId({
        labeledAccountId: 4,
        fromAccountId: 4,
        toAccountId: 1,
        sourceBefore: "2231.64",
        sourceAfter: "2231.64",
        destBefore: "3911.64",
        destAfter: "3911.64",
      })
    ).toEqual({ before: "2231.64", after: "2231.64" });
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

describe("signedAmountForEditForm", () => {
  it("shows the ledger sign so an outflow can be typed positive", () => {
    expect(signedAmountForEditForm("-2331.00", "OUTFLOW")).toBe("-2331.00");
    expect(signedAmountForEditForm("2331.00", "OUTFLOW")).toBe("-2331.00");
    expect(signedAmountForEditForm("-2331.00", "INFLOW")).toBe("2331.00");
    expect(directionFromSignedAmount("2331")).toBe("INFLOW");
    expect(directionFromSignedAmount("-2331")).toBe("OUTFLOW");
    expect(applyDirectionToSignedAmount("-2331.00", "INFLOW")).toBe("2331.00");
  });
});
