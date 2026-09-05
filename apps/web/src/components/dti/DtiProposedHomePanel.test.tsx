/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DtiProposedHousingInput, DtiProposedPurchaseInput, DtiPurchaseEstimateResult } from "@budget-app/shared";
import { emptyProposedHousingDraft, type ProposedHousingDraft } from "../../lib/dtiForm";
import {
  emptyPurchaseEstimateDraft,
  type AppliedProposedHome,
  type PurchaseEstimateDraft,
} from "../../lib/dtiProposedHome";
import DtiProposedHomePanel from "./DtiProposedHomePanel";

const purchaseEstimate: DtiPurchaseEstimateResult = {
  purchase_price: "400000.00",
  down_payment_type: "percent",
  down_payment_value: "3.50",
  down_payment_amount: "14000.00",
  down_payment_percent: "3.50",
  loan_amount: "386000.00",
  annual_interest_rate: "6.50",
  loan_term_years: 30,
  number_of_payments: 360,
  monthly: {
    principal_and_interest: "2439.78",
    property_taxes: "208.33",
    homeowners_insurance: "120.00",
    mortgage_insurance: "180.00",
    hoa_dues: "67.00",
    other_required_housing_costs: "0.00",
    total: "3015.11",
  },
};

function Harness({
  onApplyMonthly = vi.fn(),
  onApplyPurchase = vi.fn(),
  applied = null,
  purchaseResult = null,
  proposedError = false,
}: {
  onApplyMonthly?: (payload: DtiProposedHousingInput) => void;
  onApplyPurchase?: (payload: DtiProposedPurchaseInput) => void;
  applied?: AppliedProposedHome | null;
  purchaseResult?: DtiPurchaseEstimateResult | null;
  proposedError?: boolean;
}) {
  const [monthlyDraft, setMonthlyDraft] = useState<ProposedHousingDraft>(emptyProposedHousingDraft());
  const [purchaseDraft, setPurchaseDraft] = useState<PurchaseEstimateDraft>(emptyPurchaseEstimateDraft());
  const [selectedMode, setSelectedMode] = useState<"monthly_payment" | "purchase">("monthly_payment");
  return (
    <DtiProposedHomePanel
      monthlyDraft={monthlyDraft}
      purchaseDraft={purchaseDraft}
      selectedMode={selectedMode}
      applied={applied}
      proposedBusy={false}
      proposedError={proposedError}
      proposedHousingTotal={applied?.mode === "monthly_payment" ? "2600.00" : null}
      purchaseEstimate={applied?.mode === "purchase" ? purchaseResult : null}
      grossMonthlyIncome="5400.00"
      enteredMonthlyTotal="0.00"
      onMonthlyDraftChange={setMonthlyDraft}
      onPurchaseDraftChange={setPurchaseDraft}
      onSelectMode={setSelectedMode}
      onApplyMonthly={onApplyMonthly}
      onApplyPurchase={onApplyPurchase}
      onClearMonthly={() => setMonthlyDraft(emptyProposedHousingDraft())}
      onClearPurchase={() => setPurchaseDraft(emptyPurchaseEstimateDraft())}
      onRetryProposed={vi.fn()}
    />
  );
}

describe("DtiProposedHomePanel", () => {
  afterEach(() => {
    cleanup();
  });

  it("shows both named modes and monthly fields labeled Monthly", () => {
    render(<Harness />);
    expect(screen.getByRole("radio", { name: /Enter a Monthly Payment/ })).toBeChecked();
    expect(screen.getByRole("radio", { name: /Estimate From a Home Purchase/ })).not.toBeChecked();
    expect(screen.getByText(/already know the estimated monthly payment/)).toBeInTheDocument();
    expect(screen.getByLabelText("Monthly principal and interest")).toBeInTheDocument();
    expect(screen.getByLabelText("Monthly property taxes")).toBeInTheDocument();
    expect(screen.getByLabelText("Monthly homeowners insurance")).toBeInTheDocument();
    expect(screen.getByLabelText("Monthly mortgage insurance")).toBeInTheDocument();
    expect(screen.getByLabelText("Monthly HOA dues")).toBeInTheDocument();
    expect(screen.getByLabelText("Other required monthly housing costs")).toBeInTheDocument();
    expect(screen.queryByLabelText("Home purchase price")).not.toBeInTheDocument();
  });

  it("shows purchase fields and keeps monthly and purchase drafts independent", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.type(screen.getByLabelText("Monthly principal and interest"), "2100");
    await user.click(screen.getByRole("radio", { name: /Estimate From a Home Purchase/ }));
    expect(screen.getByLabelText("Home purchase price")).toBeInTheDocument();
    expect(screen.getByLabelText("Annual interest rate")).toBeInTheDocument();
    expect(screen.getByLabelText("Loan term")).toBeInTheDocument();
    expect(screen.getByLabelText("Estimated annual property taxes")).toBeInTheDocument();
    expect(screen.getByLabelText("Estimated annual homeowners insurance")).toBeInTheDocument();
    expect(screen.getByLabelText("Estimated monthly mortgage insurance")).toBeInTheDocument();
    expect(screen.getByLabelText("Monthly HOA dues")).toBeInTheDocument();
    expect(screen.queryByLabelText("Monthly principal and interest")).not.toBeInTheDocument();
    await user.type(screen.getByLabelText("Home purchase price"), "400000");
    await user.click(screen.getByRole("radio", { name: /Enter a Monthly Payment/ }));
    expect(screen.getByLabelText("Monthly principal and interest")).toHaveValue("2100");
    await user.click(screen.getByRole("radio", { name: /Estimate From a Home Purchase/ }));
    expect(screen.getByLabelText("Home purchase price")).toHaveValue("400000");
  });

  it("sends monthly components without converting them from a purchase price", async () => {
    const user = userEvent.setup();
    const onApplyMonthly = vi.fn();
    render(<Harness onApplyMonthly={onApplyMonthly} />);
    await user.type(screen.getByLabelText("Monthly principal and interest"), "2130");
    await user.click(screen.getByRole("button", { name: "Calculate Monthly DTI" }));
    expect(onApplyMonthly).toHaveBeenCalledWith(
      expect.objectContaining({ principal_and_interest: "2130.00" })
    );
  });

  it("sends a purchase-estimate payload instead of calculating P&I in the UI", async () => {
    const user = userEvent.setup();
    const onApplyPurchase = vi.fn();
    render(<Harness onApplyPurchase={onApplyPurchase} />);
    await user.click(screen.getByRole("radio", { name: /Estimate From a Home Purchase/ }));
    await user.type(screen.getByLabelText("Home purchase price"), "400000");
    await user.click(screen.getByLabelText("Percent"));
    await user.type(screen.getByLabelText("Down payment percentage"), "3.50");
    await user.type(screen.getByLabelText("Annual interest rate"), "6.50");
    await user.type(screen.getByLabelText("Estimated annual property taxes"), "2500");
    await user.click(screen.getByRole("button", { name: "Estimate Purchase DTI" }));
    expect(onApplyPurchase).toHaveBeenCalledWith(
      expect.objectContaining({
        purchase_price: "400000.00",
        down_payment_type: "percent",
        down_payment_value: "3.50",
        annual_interest_rate: "6.50",
        loan_term_years: 30,
        annual_property_taxes: "2500.00",
      })
    );
    expect(onApplyPurchase.mock.calls[0][0].principal_and_interest).toBeUndefined();
  });

  it("displays backend purchase results and does not invent a loan quote", () => {
    render(
      <Harness
        applied={{ mode: "purchase", purchase: { purchase_price: "400000.00", down_payment_type: "percent", down_payment_value: "3.50", annual_interest_rate: "6.50", loan_term_years: 30 } }}
        purchaseResult={purchaseEstimate}
      />
    );
    expect(screen.getByTestId("dti-purchase-result")).toHaveTextContent("386,000.00");
    expect(screen.getByTestId("dti-purchase-result")).toHaveTextContent("14,000.00");
    expect(screen.getByTestId("dti-purchase-result")).toHaveTextContent("2,439.78");
    expect(screen.getByText(/planning estimate for a fixed-rate loan/i)).toBeInTheDocument();
  });

  it("clears one mode without destroying the other draft", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.type(screen.getByLabelText("Monthly principal and interest"), "2100");
    await user.click(screen.getByRole("radio", { name: /Estimate From a Home Purchase/ }));
    await user.type(screen.getByLabelText("Home purchase price"), "400000");
    await user.click(screen.getByRole("button", { name: "Clear Purchase Estimate" }));
    expect(screen.getByLabelText("Home purchase price")).toHaveValue("");
    await user.click(screen.getByRole("radio", { name: /Enter a Monthly Payment/ }));
    expect(screen.getByLabelText("Monthly principal and interest")).toHaveValue("2100");
    await user.click(screen.getByRole("button", { name: "Clear Monthly Estimate" }));
    expect(screen.getByLabelText("Monthly principal and interest")).toHaveValue("");
  });

  it("warns on extreme monthly input without changing the value", async () => {
    const user = userEvent.setup();
    const onApplyMonthly = vi.fn();
    render(<Harness onApplyMonthly={onApplyMonthly} />);
    const field = screen.getByLabelText("Monthly principal and interest");
    await user.type(field, "400000");
    await user.click(screen.getByRole("button", { name: "Calculate Monthly DTI" }));
    expect(onApplyMonthly).not.toHaveBeenCalled();
    expect(screen.getByText(/unusually high for a monthly payment/)).toBeInTheDocument();
    expect(field).toHaveValue("400000");
    await user.click(screen.getByRole("button", { name: "Continue with this monthly payment" }));
    expect(onApplyMonthly).toHaveBeenCalledWith(
      expect.objectContaining({ principal_and_interest: "400000.00" })
    );
  });

  it("associates purchase field errors with aria-describedby", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("radio", { name: /Estimate From a Home Purchase/ }));
    await user.click(screen.getByRole("button", { name: "Estimate Purchase DTI" }));
    const price = screen.getByLabelText("Home purchase price");
    expect(price).toHaveAttribute("aria-invalid", "true");
    const describedBy = price.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy!.split(" ")[0] === "dti-purchase-price-error" ? "dti-purchase-price-error" : describedBy!.split(" ").find((id) => id.endsWith("error"))!)).toHaveTextContent(/greater than zero/);
  });

  it("keeps entered purchase values when the calculation fails", async () => {
    const user = userEvent.setup();
    render(<Harness proposedError />);
    await user.click(screen.getByRole("radio", { name: /Estimate From a Home Purchase/ }));
    await user.type(screen.getByLabelText("Home purchase price"), "400000");
    expect(screen.getByLabelText("Home purchase price")).toHaveValue("400000");
  });
});
