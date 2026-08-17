import { describe, it, expect } from "vitest";
import type { Account } from "@budget-app/shared";
import { formatPaymentDueValue } from "./paymentDueDisplay";

const TODAY = new Date("2026-08-16T12:00:00");

function mockCard(overrides: Partial<Account> = {}): Account {
  return {
    id: 2,
    household: { id: 1, name: "Home", created_at: "", updated_at: "" },
    account_type: "CREDIT",
    role: "credit_card",
    name: "Care Credit",
    institution: "Synchrony",
    currency: "USD",
    is_active: true,
    status: "active",
    created_at: "",
    updated_at: "",
    ...overrides,
  } as Account;
}

describe("formatPaymentDueValue", () => {
  it("does not display $0.00 when the due amount is unknown", () => {
    expect(
      formatPaymentDueValue(
        mockCard({
          next_payment_due_date: "2026-08-26",
          statement_balance: "0.00",
          minimum_payment_amount: "0.00",
          balance_owed: "926.24",
          payment_due_amount_unavailable: true,
        }),
        TODAY
      )
    ).toBe("Due Aug 26 · Amount unavailable");
  });

  it("labels a current upcoming due date as Due", () => {
    expect(
      formatPaymentDueValue(
        mockCard({
          next_payment_due_date: "2026-08-26",
          minimum_payment_amount: "25.00",
          statement_balance: "400.00",
          payment_due_amount: "25.00",
        }),
        TODAY
      )
    ).toBe("Due Aug 26 · $25.00");
  });

  it("labels a stale stored due date as Last known", () => {
    expect(
      formatPaymentDueValue(
        mockCard({
          next_payment_due_date: "2026-06-27",
          payment_due_is_stale: true,
          statement_balance: "0.00",
          minimum_payment_amount: "25.00",
          payment_due_amount: "25.00",
          balance_owed: "500.00",
        }),
        TODAY
      )
    ).toBe("Last known Jun 27 · $25.00");
  });

  it("labels a past date as Last known rather than an upcoming due date", () => {
    expect(
      formatPaymentDueValue(
        mockCard({
          next_payment_due_date: "2026-07-26",
          minimum_payment_amount: "25.00",
          payment_due_amount: "25.00",
        }),
        TODAY
      )
    ).toBe("Last known Jul 26 · $25.00");
  });

  it("shows amount with unavailable date when only the amount is known", () => {
    expect(
      formatPaymentDueValue(
        mockCard({
          next_payment_due_date: null,
          minimum_payment_amount: "25.00",
          payment_due_amount: "25.00",
        }),
        TODAY
      )
    ).toBe("Amount $25.00 · Due date unavailable");
  });

  it("shows no payment data when neither date nor amount is known", () => {
    expect(
      formatPaymentDueValue(
        mockCard({
          next_payment_due_date: null,
          statement_balance: "0.00",
          minimum_payment_amount: "0.00",
          balance_owed: "0",
        }),
        TODAY
      )
    ).toBe("No payment data");
  });
});
