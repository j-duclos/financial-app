import { isDebtGoalType } from "./goalDisplay";
import type { GoalFundingFormState } from "./goalFundingForm";
import { validateGoalFundingForm } from "./goalFundingForm";

export type GoalFormValidationInput = {
  name: string;
  goal_type: string;
  target_amount: string;
  target_date: string;
  linked_account: number | "";
  linked_credit_account: number | "";
  monthly_contribution: string;
  funding: GoalFundingFormState;
};

export type GoalFormFieldErrors = {
  name?: string;
  target_amount?: string;
  target_date?: string;
  linked_account?: string;
  linked_credit_account?: string;
  monthly_contribution?: string;
  funding?: string;
};

function parseAmount(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed === "") return null;
  const n = parseFloat(trimmed);
  return Number.isFinite(n) ? n : null;
}

function isValidIsoDate(value: string): boolean {
  const datePart = value.trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(datePart)) return false;
  const d = new Date(`${datePart}T12:00:00`);
  return !Number.isNaN(d.getTime());
}

export function validateGoalForm(values: GoalFormValidationInput): GoalFormFieldErrors {
  const errors: GoalFormFieldErrors = {};
  const isDebt = isDebtGoalType(values.goal_type);

  if (!values.name.trim()) {
    errors.name = "Goal name required";
  }

  const target = parseAmount(values.target_amount);
  if (target == null || target <= 0) {
    errors.target_amount = isDebt
      ? "Payoff target must be greater than $0"
      : "Target amount must be greater than $0";
  }

  if (values.target_date.trim() && !isValidIsoDate(values.target_date)) {
    errors.target_date = "Target date invalid";
  }

  const monthly = parseAmount(values.monthly_contribution);
  if (values.monthly_contribution.trim() !== "" && (monthly == null || monthly < 0)) {
    errors.monthly_contribution = "Contribution cannot be negative";
  }

  if (isDebt) {
    if (!values.linked_credit_account) {
      errors.linked_credit_account = "Select a credit card or loan";
    }
  } else if (!values.linked_account) {
    errors.linked_account = "Select a linked account";
  }

  if (!isDebt) {
    const fundingError = validateGoalFundingForm(values.funding, values.monthly_contribution);
    if (fundingError) errors.funding = fundingError;
  }

  return errors;
}

export function goalFormHasErrors(errors: GoalFormFieldErrors): boolean {
  return Object.values(errors).some(Boolean);
}
