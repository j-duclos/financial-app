/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import type { DtiCreditCardSuggestion, DtiDebtItem } from "@budget-app/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import DtiDebtFormModal from "./DtiDebtFormModal";

const suggestion: DtiCreditCardSuggestion = {
  account_id: 7,
  name: "Visa",
  effective_display_name: "Everyday Visa",
  current_balance: "2993.00",
  minimum_payment_amount: "125.00",
  minimum_payment_usable: true,
  suggested_debt_type: "credit_card",
};

function renderModal(
  overrides: Partial<ComponentProps<typeof DtiDebtFormModal>> = {}
) {
  const onSubmit = vi.fn();
  render(
    <DtiDebtFormModal
      open
      householdId={1}
      initial={null}
      prefill={null}
      debts={[]}
      suggestions={[]}
      saving={false}
      error={null}
      onClose={vi.fn()}
      onSubmit={onSubmit}
      {...overrides}
    />
  );
  return { onSubmit };
}

async function chooseStudentLoan(user: ReturnType<typeof userEvent.setup>) {
  await user.selectOptions(screen.getByLabelText("Debt type"), "student_loan");
}

describe("DtiDebtFormModal student-loan fields", () => {
  afterEach(() => {
    cleanup();
  });

  it("hides student-loan fields for auto loans and still submits a monthly payment", async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderModal();
    expect(screen.queryByLabelText("Loan status")).not.toBeInTheDocument();
    expect(
      screen.queryByText("How should the monthly DTI payment be calculated?")
    ).not.toBeInTheDocument();
    await user.type(screen.getByLabelText("Name"), "Car");
    await user.type(screen.getByLabelText("Monthly payment"), "412.00");
    await user.click(screen.getByRole("button", { name: "Add debt" }));
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Car",
        debt_type: "auto_loan",
        monthly_payment: "412.00",
        student_loan_status: null,
        student_loan_payment_method: null,
      })
    );
  });

  it("keeps credit-card linking and does not auto-select the FHA method", async () => {
    const user = userEvent.setup();
    renderModal({ suggestions: [suggestion] });
    await user.selectOptions(screen.getByLabelText("Debt type"), "credit_card");
    expect(screen.getByLabelText("Linked credit-card account (optional)")).toBeInTheDocument();
    expect(screen.queryByLabelText("Loan status")).not.toBeInTheDocument();
    await chooseStudentLoan(user);
    expect(screen.getByLabelText("Loan status")).toBeInTheDocument();
    expect(screen.getByLabelText("Manual or reported monthly payment")).toBeChecked();
    expect(
      screen.getByLabelText("FHA deferred/zero-payment estimate — 0.5% of balance")
    ).not.toBeChecked();
    expect(screen.getByLabelText("Monthly payment")).toBeInTheDocument();
  });

  it("requires monthly payment for the manual student-loan method", async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderModal();
    await chooseStudentLoan(user);
    await user.type(screen.getByLabelText("Name"), "Federal student loans");
    await user.selectOptions(screen.getByLabelText("Loan status"), "repayment");
    await user.click(screen.getByRole("button", { name: "Add debt" }));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Monthly payment")).toHaveAttribute("aria-invalid", "true");
  });

  it("requires outstanding balance for the FHA estimate and shows a 0.5% preview", async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderModal();
    await chooseStudentLoan(user);
    await user.type(screen.getByLabelText("Name"), "Federal student loans");
    await user.selectOptions(screen.getByLabelText("Loan status"), "deferred");
    await user.click(
      screen.getByLabelText("FHA deferred/zero-payment estimate — 0.5% of balance")
    );
    expect(screen.queryByLabelText("Monthly payment")).not.toBeInTheDocument();
    expect(screen.getByText(/0\.5% of the outstanding balance/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Add debt" }));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Outstanding balance")).toHaveAttribute("aria-invalid", "true");
    await user.type(screen.getByLabelText("Outstanding balance"), "109058.00");
    expect(screen.getByTestId("dti-fha-preview")).toHaveTextContent(/545\.29/);
    await user.click(screen.getByRole("button", { name: "Add debt" }));
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        debt_type: "student_loan",
        student_loan_status: "deferred",
        student_loan_payment_method: "fha_deferred_balance_percent",
        outstanding_balance: "109058.00",
        payment_source: "manual",
        linked_account_id: null,
      })
    );
    expect(onSubmit.mock.calls[0][0].monthly_payment).toBeUndefined();
  });

  it("shows backend field errors on the student-loan form", async () => {
    renderModal({
      error: new Error(
        "outstanding_balance: A positive outstanding balance is required for the FHA 0.5% estimate."
      ),
    });
    await userEvent.setup().selectOptions(screen.getByLabelText("Debt type"), "student_loan");
    const balance = screen.getByLabelText(/Outstanding balance/);
    expect(balance).toHaveAttribute("aria-invalid", "true");
    const describedBy = balance.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy!)).toHaveTextContent(
      /positive outstanding balance/
    );
  });
});

describe("DtiDebtFormModal saved student-loan values", () => {
  afterEach(() => {
    cleanup();
  });

  it("loads an FHA student loan without selecting FHA for a new auto-loan form", async () => {
    const initial: DtiDebtItem = {
      id: 12,
      household_id: 1,
      name: "Federal student loans",
      debt_type: "student_loan",
      monthly_payment: "0.00",
      payment_source: "manual",
      student_loan_status: "deferred",
      student_loan_payment_method: "fha_deferred_balance_percent",
      effective_monthly_payment: "545.29",
      outstanding_balance: "109058.00",
      linked_account_id: null,
      linked_account: null,
      included: true,
      months_remaining: null,
      notes: "",
      position: 0,
      created_at: "",
      updated_at: "",
    };
    renderModal({ initial });
    expect(
      screen.getByLabelText("FHA deferred/zero-payment estimate — 0.5% of balance")
    ).toBeChecked();
    cleanup();
    renderModal();
    expect(screen.getByLabelText("Debt type")).toHaveValue("auto_loan");
    expect(screen.queryByLabelText("Loan status")).not.toBeInTheDocument();
  });
});
