import { describe, it, expect } from "vitest";
import type { Account } from "@budget-app/shared";
import { formatPaymentDueValue } from "./paymentDueDisplay";

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
          next_payment_due_date: "2026-07-26",
          statement_balance: "0.00",
          minimum_payment_amount: "0.00",
          balance_owed: "926.24",
          payment_due_amount_unavailable: true,
        })
      )
    ).toBe("07-26-26 · Amount unavailable");
  });

  it("uses the known minimum payment when present", () => {
    expect(
      formatPaymentDueValue(
        mockCard({
          next_payment_due_date: "2026-08-20",
          minimum_payment_amount: "35.00",
          statement_balance: "400.00",
          payment_due_amount: "35.00",
        })
      )
    ).toBe("08-20-26 · $35.00");
  });

  it("labels a stale stored due date instead of treating it as current", () => {
    expect(
      formatPaymentDueValue(
        mockCard({
          next_payment_due_date: "2026-01-10",
          payment_due_is_stale: true,
          statement_balance: "0.00",
          minimum_payment_amount: "0.00",
          balance_owed: "500.00",
          payment_due_amount_unavailable: true,
        })
      )
    ).toBe("Last known 01-10-26 · Amount unavailable");
  });
});
