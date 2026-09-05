/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Account } from "@budget-app/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CreditMinimumPaymentFields } from "./CreditMinimumPaymentFields";
import { formatMinimumPaymentSourceLine } from "../../lib/minimumPaymentDisplay";

function card(overrides: Partial<Account> = {}): Account {
  return {
    id: 7,
    household: { id: 1, name: "HH", created_at: "", updated_at: "" },
    account_type: "CREDIT",
    role: "credit_card",
    name: "Visa",
    institution: "",
    is_active: true,
    created_at: "",
    updated_at: "",
    currency: "USD",
    minimum_payment_amount: "86.00",
    effective_minimum_payment_amount: "86.00",
    minimum_payment_mode: "automatic",
    minimum_payment_source: "plaid",
    provider_minimum_payment_amount: "86.00",
    manual_minimum_payment_amount: "100.00",
    provider_minimum_payment_observed_at: "2026-09-05T20:00:00Z",
    minimum_payment_freshness: "fresh",
    plaid_item_id: 12,
    ...overrides,
  };
}

describe("CreditMinimumPaymentFields", () => {
  afterEach(() => {
    cleanup();
  });

  it("displays automatic and manual modes", async () => {
    const user = userEvent.setup();
    const onModeChange = vi.fn();
    render(
      <CreditMinimumPaymentFields
        account={card()}
        mode="automatic"
        manualAmount="100.00"
        onModeChange={onModeChange}
        onManualAmountChange={vi.fn()}
      />
    );
    expect(screen.getByLabelText("Automatically sync from institution")).toBeChecked();
    expect(screen.getByText(/synced from institution/i)).toBeInTheDocument();
    expect(screen.getByText(/Fresh provider value/i)).toBeInTheDocument();
    await user.click(screen.getByLabelText("Enter manually"));
    expect(onModeChange).toHaveBeenCalledWith("manual");
  });

  it("shows the manual value as effective and the provider difference", () => {
    render(
      <CreditMinimumPaymentFields
        account={card({
          minimum_payment_mode: "manual",
          minimum_payment_source: "manual",
          minimum_payment_freshness: "manual",
          effective_minimum_payment_amount: "100.00",
          minimum_payment_amount: "100.00",
        })}
        mode="manual"
        manualAmount="100.00"
        onModeChange={vi.fn()}
        onManualAmountChange={vi.fn()}
      />
    );
    expect(screen.getByLabelText("Manual minimum payment")).toHaveValue(100);
    expect(screen.getByText(/manually entered/i)).toBeInTheDocument();
    expect(screen.getByText(/differs from the manual minimum/i)).toBeInTheDocument();
  });

  it("refresh action calls the provided handler and keeps data on failure", async () => {
    const user = userEvent.setup();
    const onRefresh = vi.fn();
    render(
      <CreditMinimumPaymentFields
        account={card()}
        mode="automatic"
        manualAmount="100.00"
        onModeChange={vi.fn()}
        onManualAmountChange={vi.fn()}
        onRefresh={onRefresh}
        refreshError="Could not refresh the institution minimum."
      />
    );
    expect(screen.getByText("$86.00/month — synced from institution")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /refresh from institution/i }));
    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/could not refresh/i)).toBeInTheDocument();
    expect(screen.getByText("$86.00/month — synced from institution")).toBeInTheDocument();
  });

  it("switching modes keeps both stored values visible", async () => {
    const user = userEvent.setup();
    const onModeChange = vi.fn();
    const { rerender } = render(
      <CreditMinimumPaymentFields
        account={card()}
        mode="automatic"
        manualAmount="100.00"
        onModeChange={onModeChange}
        onManualAmountChange={vi.fn()}
      />
    );
    expect(screen.getByText(/Last provider minimum: \$86\.00/i)).toBeInTheDocument();
    expect(screen.getByText(/Manual fallback: \$100\.00/i)).toBeInTheDocument();
    await user.click(screen.getByLabelText("Enter manually"));
    rerender(
      <CreditMinimumPaymentFields
        account={card({
          minimum_payment_mode: "manual",
          minimum_payment_source: "manual",
          minimum_payment_freshness: "manual",
          effective_minimum_payment_amount: "100.00",
          minimum_payment_amount: "100.00",
        })}
        mode="manual"
        manualAmount="100.00"
        onModeChange={onModeChange}
        onManualAmountChange={vi.fn()}
      />
    );
    expect(screen.getByLabelText("Manual minimum payment")).toHaveValue(100);
    expect(screen.getByText(/Last institution value: \$86\.00/i)).toBeInTheDocument();
  });

  it("explains unsupported and reauthorization statuses", () => {
    const { rerender } = render(
      <CreditMinimumPaymentFields
        account={card({ minimum_payment_freshness: "unsupported" })}
        mode="automatic"
        manualAmount=""
        onModeChange={vi.fn()}
        onManualAmountChange={vi.fn()}
      />
    );
    expect(screen.getByText(/Provider unsupported/i)).toBeInTheDocument();
    rerender(
      <CreditMinimumPaymentFields
        account={card({ minimum_payment_freshness: "reauthorization_required" })}
        mode="automatic"
        manualAmount=""
        onModeChange={vi.fn()}
        onManualAmountChange={vi.fn()}
      />
    );
    expect(screen.getByText(/Reauthorization required/i)).toBeInTheDocument();
  });
});

describe("formatMinimumPaymentSourceLine", () => {
  it("labels stale provider data for review", () => {
    expect(
      formatMinimumPaymentSourceLine(
        card({ minimum_payment_freshness: "stale", minimum_payment_source: "plaid" })
      )
    ).toMatch(/refresh recommended/i);
  });
});
