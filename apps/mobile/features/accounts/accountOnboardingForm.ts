import type { AccountType } from "@budget-app/shared";
import { parseUnsignedMoney, sanitizeUnsignedMoneyInput } from "@/lib/moneyInput";

export type AccountOnboardingForm = {
  name: string;
  institution: string;
  account_type: AccountType;
  starting_balance: string;
  credit_limit: string;
};

export function sanitizeAccountMoneyInput(raw: string): string {
  return sanitizeUnsignedMoneyInput(raw);
}

export function validateAccountOnboardingForm(form: AccountOnboardingForm): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!form.name.trim()) errors.name = "Account name is required.";
  const isCredit = form.account_type === "CREDIT";
  const balanceLabel = isCredit ? "Current balance owed" : "Starting balance";
  const trimmedBalance = form.starting_balance.trim();
  if (trimmedBalance) {
    const n = parseUnsignedMoney(trimmedBalance);
    if (n == null) errors.starting_balance = `${balanceLabel} must be a valid amount.`;
  }
  if (isCredit) {
    const trimmedLimit = form.credit_limit.trim();
    if (trimmedLimit) {
      const n = parseUnsignedMoney(trimmedLimit);
      if (n == null) errors.credit_limit = "Credit limit must be a valid amount.";
    }
  }
  return errors;
}

/** Maps the simplified mobile form onto existing account API fields. */
export function accountCreateApiPayload(form: AccountOnboardingForm, householdId: number) {
  const name = form.name.trim();
  const isCredit = form.account_type === "CREDIT";
  return {
    household: householdId,
    name,
    display_name: "",
    institution: form.institution.trim(),
    account_type: form.account_type,
    starting_balance: form.starting_balance.trim() || null,
    credit_limit: isCredit ? form.credit_limit.trim() || null : null,
  };
}
