import type {
  DtiDownPaymentType,
  DtiProposedHousingInput,
  DtiProposedHousingMode,
  DtiProposedPurchaseInput,
  DtiPurchaseEstimateResult,
} from "@budget-app/shared";
import { formatCurrency } from "@budget-app/shared";
import {
  MONEY_ZERO,
  normalizeMoneyInput,
  parseMoneyToCents,
  parsePercentToHundredths,
  centsToMoney,
  type ProposedHousingDraft,
} from "./dtiForm";

export const DTI_LOAN_TERM_YEARS = [10, 15, 20, 25, 30] as const;
export const MAX_LOAN_TERM_YEARS = 50;
export const MAX_ANNUAL_INTEREST_RATE = "50.00";
/** Warn when total monthly housing is at least this many times gross monthly income. */
export const MONTHLY_HOUSING_PLAUSIBILITY_INCOME_MULTIPLE = 4;
export const MONTHLY_COMPONENT_PLAUSIBILITY_INCOME_MULTIPLE = 2;

export const MONTHLY_PAYMENT_MODE_NAME = "Enter a Monthly Payment";
export const PURCHASE_MODE_NAME = "Estimate From a Home Purchase";

export const MONTHLY_PAYMENT_MODE_HELP =
  "Use this when you already know the estimated monthly payment from a lender, listing, or mortgage calculator.";
export const PURCHASE_MODE_HELP =
  "Enter the home price, down payment, interest rate, loan term, and estimated ownership costs. We’ll estimate the monthly housing payment used for DTI.";

export const EXTREME_MONTHLY_WARNING =
  "This appears unusually high for a monthly payment. Did you mean to use “Estimate From a Home Purchase” and enter a purchase price?";

export type MonthlyPaymentField = keyof ProposedHousingDraft;

export const MONTHLY_PAYMENT_FIELD_COPY: Record<
  MonthlyPaymentField,
  { label: string; hint: string }
> = {
  principal_and_interest: {
    label: "Monthly principal and interest",
    hint: "The mortgage payment before taxes, insurance, HOA dues, and other housing costs.",
  },
  property_taxes: {
    label: "Monthly property taxes",
    hint: "Enter the monthly amount. If you only know the annual tax estimate, use “Estimate From a Home Purchase.”",
  },
  homeowners_insurance: {
    label: "Monthly homeowners insurance",
    hint: "Enter the monthly premium.",
  },
  mortgage_insurance: {
    label: "Monthly mortgage insurance",
    hint: "Enter the monthly PMI or mortgage-insurance amount, if applicable.",
  },
  hoa_dues: {
    label: "Monthly HOA dues",
    hint: "Enter monthly HOA dues, if applicable.",
  },
  other_required_housing_costs: {
    label: "Other required monthly housing costs",
    hint: "Include only required recurring housing costs that should be included in the payment estimate.",
  },
};

export type PurchaseEstimateDraft = {
  purchase_price: string;
  down_payment_type: DtiDownPaymentType;
  down_payment_value: string;
  annual_interest_rate: string;
  loan_term_years: string;
  custom_loan_term: boolean;
  annual_property_taxes: string;
  annual_homeowners_insurance: string;
  monthly_mortgage_insurance: string;
  monthly_hoa_dues: string;
  other_required_monthly_housing_costs: string;
};

export type PurchaseEstimateDraftErrors = Partial<Record<keyof PurchaseEstimateDraft, string>>;

export function emptyPurchaseEstimateDraft(): PurchaseEstimateDraft {
  return {
    purchase_price: "",
    down_payment_type: "dollars",
    down_payment_value: "",
    annual_interest_rate: "",
    loan_term_years: "30",
    custom_loan_term: false,
    annual_property_taxes: "",
    annual_homeowners_insurance: "",
    monthly_mortgage_insurance: "",
    monthly_hoa_dues: "",
    other_required_monthly_housing_costs: "",
  };
}

export type AppliedProposedHome =
  | { mode: "monthly_payment"; housing: DtiProposedHousingInput }
  | { mode: "purchase"; purchase: DtiProposedPurchaseInput };

export function isImplausibleMonthlyHousing(
  payload: DtiProposedHousingInput,
  grossMonthlyIncome: string | null | undefined
): boolean {
  const incomeCents = parseMoneyToCents(grossMonthlyIncome ?? "");
  if (incomeCents == null || incomeCents <= 0) return false;
  const fields = [
    payload.principal_and_interest,
    payload.property_taxes,
    payload.homeowners_insurance,
    payload.mortgage_insurance,
    payload.hoa_dues,
    payload.other_required_housing_costs,
  ];
  let total = 0;
  for (const value of fields) {
    const cents = parseMoneyToCents(value ?? MONEY_ZERO) ?? 0;
    total += cents;
    if (cents >= incomeCents * MONTHLY_COMPONENT_PLAUSIBILITY_INCOME_MULTIPLE) return true;
  }
  return total >= incomeCents * MONTHLY_HOUSING_PLAUSIBILITY_INCOME_MULTIPLE;
}

function normalizeBoundedPercent(
  raw: string,
  maxPercent: number
): { ok: true; value: string } | { ok: false; error: string } {
  const trimmed = raw.trim().replace(/%/g, "");
  if (trimmed === "") return { ok: true, value: MONEY_ZERO };
  if (trimmed.startsWith("-")) return { ok: false, error: "Value cannot be negative." };
  const hundredths = parsePercentToHundredths(trimmed);
  if (hundredths == null) return { ok: false, error: "Enter a valid percentage." };
  if (hundredths > maxPercent * 100) {
    return { ok: false, error: `Percentage cannot exceed ${maxPercent}.` };
  }
  return { ok: true, value: centsToMoney(hundredths) };
}

export function normalizePurchaseEstimateDraft(
  draft: PurchaseEstimateDraft
):
  | { ok: true; payload: DtiProposedPurchaseInput }
  | { ok: false; errors: PurchaseEstimateDraftErrors } {
  const errors: PurchaseEstimateDraftErrors = {};
  const price = normalizeMoneyInput(draft.purchase_price);
  if (!price.ok) errors.purchase_price = price.error;
  else if (price.value === MONEY_ZERO) {
    errors.purchase_price = "Home purchase price must be greater than zero.";
  }
  let downPaymentValue = MONEY_ZERO;
  if (draft.down_payment_type === "percent") {
    const percent = normalizeBoundedPercent(draft.down_payment_value, 100);
    if (!percent.ok) errors.down_payment_value = percent.error;
    else downPaymentValue = percent.value;
  } else {
    const amount = normalizeMoneyInput(draft.down_payment_value);
    if (!amount.ok) errors.down_payment_value = amount.error;
    else downPaymentValue = amount.value;
  }
  const rate = normalizeBoundedPercent(
    draft.annual_interest_rate.trim() === "" ? "0" : draft.annual_interest_rate,
    50
  );
  if (!rate.ok) errors.annual_interest_rate = rate.error;
  const termRaw = draft.loan_term_years.trim();
  const term = Number(termRaw);
  if (!Number.isInteger(term) || term < 1 || term > MAX_LOAN_TERM_YEARS) {
    errors.loan_term_years = "Loan term must be a whole number of years from 1 to 50.";
  }
  const annualTaxes = normalizeMoneyInput(draft.annual_property_taxes);
  if (!annualTaxes.ok) errors.annual_property_taxes = annualTaxes.error;
  const annualInsurance = normalizeMoneyInput(draft.annual_homeowners_insurance);
  if (!annualInsurance.ok) errors.annual_homeowners_insurance = annualInsurance.error;
  const mi = normalizeMoneyInput(draft.monthly_mortgage_insurance);
  if (!mi.ok) errors.monthly_mortgage_insurance = mi.error;
  const hoa = normalizeMoneyInput(draft.monthly_hoa_dues);
  if (!hoa.ok) errors.monthly_hoa_dues = hoa.error;
  const other = normalizeMoneyInput(draft.other_required_monthly_housing_costs);
  if (!other.ok) errors.other_required_monthly_housing_costs = other.error;
  if (price.ok && price.value !== MONEY_ZERO && draft.down_payment_type === "dollars") {
    const priceCents = parseMoneyToCents(price.value) ?? 0;
    const downCents = parseMoneyToCents(downPaymentValue) ?? 0;
    if (downCents > priceCents) {
      errors.down_payment_value = "Down payment cannot exceed the home purchase price.";
    }
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    payload: {
      purchase_price: price.ok ? price.value : MONEY_ZERO,
      down_payment_type: draft.down_payment_type,
      down_payment_value: downPaymentValue,
      annual_interest_rate: rate.ok ? rate.value : MONEY_ZERO,
      loan_term_years: term,
      annual_property_taxes: annualTaxes.ok ? annualTaxes.value : MONEY_ZERO,
      annual_homeowners_insurance: annualInsurance.ok ? annualInsurance.value : MONEY_ZERO,
      monthly_mortgage_insurance: mi.ok ? mi.value : MONEY_ZERO,
      monthly_hoa_dues: hoa.ok ? hoa.value : MONEY_ZERO,
      other_required_monthly_housing_costs: other.ok ? other.value : MONEY_ZERO,
    },
  };
}

export function purchaseEstimateSummary(estimate: DtiPurchaseEstimateResult): string {
  return `Based on a ${formatCurrency(estimate.purchase_price)} purchase price, ${formatCurrency(estimate.down_payment_amount)} down payment, ${estimate.annual_interest_rate}% annual interest rate, and ${estimate.loan_term_years}-year fixed-rate term.`;
}

export function appliedProposedMode(applied: AppliedProposedHome | null): DtiProposedHousingMode | null {
  return applied?.mode ?? null;
}
