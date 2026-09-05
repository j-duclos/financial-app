import type {
  DtiCalculationRequest,
  DtiCreditCardSuggestion,
  DtiDebtItem,
  DtiDebtItemWritePayload,
  DtiIncomeSourceWritePayload,
  DtiPaymentSource,
  DtiProfileWritePayload,
  DtiProposedHousingInput,
  DtiProposedHousingMode,
  DtiProposedPurchaseInput,
  DtiStudentLoanPaymentMethod,
  DtiStudentLoanStatus,
} from "@budget-app/shared";

export const MONEY_ZERO = "0.00";

const MONEY_PATTERN = /^\d+(\.\d{1,2})?$/;
const PERCENT_PATTERN = /^\d+(\.\d{1,2})?$/;

export const PROPOSED_HOUSING_FIELDS = [
  "principal_and_interest",
  "property_taxes",
  "homeowners_insurance",
  "mortgage_insurance",
  "hoa_dues",
  "other_required_housing_costs",
] as const;

export type ProposedHousingField = (typeof PROPOSED_HOUSING_FIELDS)[number];

export type ProposedHousingDraft = Record<ProposedHousingField, string>;

export function emptyProposedHousingDraft(): ProposedHousingDraft {
  return {
    principal_and_interest: "",
    property_taxes: "",
    homeowners_insurance: "",
    mortgage_insurance: "",
    hoa_dues: "",
    other_required_housing_costs: "",
  };
}

export function parseMoneyToCents(raw: string): number | null {
  const trimmed = raw.trim().replace(/[$,]/g, "");
  if (trimmed === "") return 0;
  if (trimmed.startsWith("-")) return null;
  if (!MONEY_PATTERN.test(trimmed)) return null;
  const [whole, frac = ""] = trimmed.split(".");
  return Number(whole) * 100 + Number((frac + "00").slice(0, 2));
}

export function centsToMoney(cents: number): string {
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100);
  const frac = String(abs % 100).padStart(2, "0");
  return `${cents < 0 ? "-" : ""}${whole}.${frac}`;
}

/** Display percent used in FHA deferred student-loan estimates (0.50 = 0.5%). */
export const FHA_DEFERRED_STUDENT_LOAN_PERCENT = "0.50";
/** Integer form of 0.005: cents × 5 / 1000, rounded half-up. */
const FHA_PREVIEW_NUMERATOR = 5;
const FHA_PREVIEW_DENOMINATOR = 1000;

/** Presentation-only FHA 0.5% preview. Backend effective payment is authoritative. */
export function previewFhaDeferredStudentLoanPayment(balance: string): string | null {
  const cents = parseMoneyToCents(balance);
  if (cents == null || cents <= 0) return null;
  const scaled = cents * FHA_PREVIEW_NUMERATOR;
  const remainder = scaled % FHA_PREVIEW_DENOMINATOR;
  const quotient = (scaled - remainder) / FHA_PREVIEW_DENOMINATOR;
  const rounded = remainder >= FHA_PREVIEW_DENOMINATOR / 2 ? quotient + 1 : quotient;
  return centsToMoney(rounded);
}

/** Presentation-only difference of two decimal-string amounts. */
export function subtractMoneyStrings(minuend: string, subtrahend: string): string | null {
  const left = parseMoneyToCents(minuend);
  const right = parseMoneyToCents(subtrahend);
  if (left == null || right == null) return null;
  return centsToMoney(left - right);
}

export function normalizeMoneyInput(
  raw: string
): { ok: true; value: string } | { ok: false; error: string } {
  const trimmed = raw.trim().replace(/[$,]/g, "");
  if (trimmed === "") return { ok: true, value: MONEY_ZERO };
  if (trimmed.startsWith("-")) return { ok: false, error: "Amount cannot be negative." };
  const cents = parseMoneyToCents(trimmed);
  if (cents == null) return { ok: false, error: "Enter a valid amount." };
  return { ok: true, value: centsToMoney(cents) };
}

export function parsePercentToHundredths(raw: string): number | null {
  const trimmed = raw.trim().replace(/%/g, "");
  if (trimmed === "") return null;
  if (trimmed.startsWith("-")) return null;
  if (!PERCENT_PATTERN.test(trimmed)) return null;
  const [whole, frac = ""] = trimmed.split(".");
  return Number(whole) * 100 + Number((frac + "00").slice(0, 2));
}

export function normalizePercentInput(
  raw: string,
  options: { optional?: boolean } = {}
): { ok: true; value: string | null } | { ok: false; error: string } {
  const trimmed = raw.trim().replace(/%/g, "");
  if (trimmed === "") {
    if (options.optional) return { ok: true, value: null };
    return { ok: false, error: "Enter a target greater than 0 and at most 100." };
  }
  const hundredths = parsePercentToHundredths(trimmed);
  if (hundredths == null || hundredths <= 0 || hundredths > 10000) {
    return { ok: false, error: "Target DTI must be greater than 0 and no more than 100." };
  }
  return { ok: true, value: centsToMoney(hundredths) };
}

export function normalizeProposedHousingDraft(
  draft: ProposedHousingDraft
): { ok: true; payload: DtiProposedHousingInput } | { ok: false; errors: Partial<ProposedHousingDraft> } {
  const errors: Partial<ProposedHousingDraft> = {};
  const payload: DtiProposedHousingInput = {};
  for (const field of PROPOSED_HOUSING_FIELDS) {
    const result = normalizeMoneyInput(draft[field]);
    if (!result.ok) {
      errors[field] = result.error;
    } else {
      payload[field] = result.value;
    }
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, payload };
}

/** Presentation-only sum of drafted housing fields. Official totals come from the API. */
export function sumProposedHousingDraft(draft: ProposedHousingDraft): string {
  let cents = 0;
  for (const field of PROPOSED_HOUSING_FIELDS) {
    const parsed = parseMoneyToCents(draft[field]);
    if (parsed == null) continue;
    cents += parsed;
  }
  return centsToMoney(cents);
}

export function proposedHousingPayloadForRequest(
  payload: DtiProposedHousingInput
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const field of PROPOSED_HOUSING_FIELDS) {
    out[field] = payload[field] ?? MONEY_ZERO;
  }
  return out;
}

export function sortedExcludedDebtItemIds(ids: Iterable<number>): number[] {
  return [...new Set(ids)].sort((a, b) => a - b);
}

export function toggleExcludedDebtItemId(ids: number[], debtItemId: number): number[] {
  const set = new Set(ids);
  if (set.has(debtItemId)) set.delete(debtItemId);
  else set.add(debtItemId);
  return sortedExcludedDebtItemIds(set);
}

export function buildDtiCalculationRequest(args: {
  householdId: number;
  proposedHousing: DtiProposedHousingInput | null;
  excludedDebtItemIds: number[];
  proposedHousingMode?: DtiProposedHousingMode | null;
  proposedPurchase?: DtiProposedPurchaseInput | null;
}): DtiCalculationRequest {
  const request: DtiCalculationRequest = { household_id: args.householdId };
  const mode = args.proposedHousingMode
    ?? (args.proposedPurchase ? "purchase" : args.proposedHousing ? "monthly_payment" : null);
  if (mode === "purchase" && args.proposedPurchase) {
    request.proposed_housing_mode = "purchase";
    request.proposed_purchase = args.proposedPurchase;
  } else if (args.proposedHousing) {
    request.proposed_housing_mode = "monthly_payment";
    request.proposed_housing = proposedHousingPayloadForRequest(args.proposedHousing);
  }
  const excluded = sortedExcludedDebtItemIds(args.excludedDebtItemIds);
  if (excluded.length > 0) {
    request.excluded_debt_item_ids = excluded;
  }
  return request;
}

export function normalizeIncomeWritePayload(
  householdId: number,
  values: {
    name: string;
    income_type: DtiIncomeSourceWritePayload["income_type"];
    gross_monthly_amount: string;
    included: boolean;
    notes: string;
  }
): { ok: true; payload: DtiIncomeSourceWritePayload } | { ok: false; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  const name = values.name.trim();
  if (!name) errors.name = "Name cannot be blank.";
  const amount = normalizeMoneyInput(values.gross_monthly_amount);
  if (!amount.ok) errors.gross_monthly_amount = amount.error;
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    payload: {
      household_id: householdId,
      name,
      income_type: values.income_type,
      gross_monthly_amount: amount.ok ? amount.value : MONEY_ZERO,
      included: values.included,
      notes: values.notes.trim(),
    },
  };
}

export function normalizeProfileWritePayload(values: {
  current_housing_label: string;
  current_housing_payment: string;
  include_current_housing_in_current_dti: boolean;
  target_back_end_dti_percent: string;
  target_front_end_dti_percent: string;
}): { ok: true; payload: DtiProfileWritePayload } | { ok: false; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  const housing = normalizeMoneyInput(values.current_housing_payment);
  if (!housing.ok) errors.current_housing_payment = housing.error;
  const back = normalizePercentInput(values.target_back_end_dti_percent);
  if (!back.ok) errors.target_back_end_dti_percent = back.error;
  const front = normalizePercentInput(values.target_front_end_dti_percent, { optional: true });
  if (!front.ok) errors.target_front_end_dti_percent = front.error;
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    payload: {
      current_housing_label: values.current_housing_label.trim(),
      current_housing_payment: housing.ok ? housing.value : MONEY_ZERO,
      include_current_housing_in_current_dti: values.include_current_housing_in_current_dti,
      target_back_end_dti_percent: back.ok && back.value ? back.value : undefined,
      target_front_end_dti_percent: front.ok ? front.value : null,
    },
  };
}

export function suggestionPrefill(suggestion: DtiCreditCardSuggestion): {
  name: string;
  debt_type: "credit_card";
  linked_account_id: number;
  outstanding_balance: string;
  payment_source: DtiPaymentSource;
  monthly_payment: string;
  included: boolean;
} {
  const minimumUsable = suggestion.minimum_payment_usable;
  return {
    name: suggestion.effective_display_name || suggestion.name,
    debt_type: "credit_card",
    linked_account_id: suggestion.account_id,
    outstanding_balance: suggestion.current_balance,
    payment_source: minimumUsable ? "linked_account_minimum" : "manual",
    monthly_payment: "",
    included: true,
  };
}

export function normalizeDebtWritePayload(
  householdId: number,
  values: {
    name: string;
    debt_type: DtiDebtItemWritePayload["debt_type"];
    monthly_payment: string;
    outstanding_balance: string;
    payment_source: DtiPaymentSource;
    linked_account_id: number | null;
    included: boolean;
    months_remaining: string;
    notes: string;
    student_loan_status?: DtiStudentLoanStatus | "";
    student_loan_payment_method?: DtiStudentLoanPaymentMethod | "";
  }
): { ok: true; payload: DtiDebtItemWritePayload } | { ok: false; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  const name = values.name.trim();
  if (!name) errors.name = "Name cannot be blank.";
  const isStudentLoan = values.debt_type === "student_loan";
  const studentMethod: DtiStudentLoanPaymentMethod =
    isStudentLoan && values.student_loan_payment_method === "fha_deferred_balance_percent"
      ? "fha_deferred_balance_percent"
      : "manual";
  const studentStatus =
    isStudentLoan && values.student_loan_status ? values.student_loan_status : null;
  if (values.payment_source === "linked_account_minimum" && values.linked_account_id == null) {
    errors.linked_account_id = "Select a linked credit-card account to use its minimum.";
  }
  if (values.payment_source === "linked_account_minimum" && values.debt_type !== "credit_card") {
    errors.payment_source = "Linked account minimums can only be used with credit cards.";
  }
  if (studentMethod === "fha_deferred_balance_percent") {
    if (values.debt_type !== "student_loan") {
      errors.student_loan_payment_method =
        "The FHA deferred estimate can only be used with student-loan debts.";
    }
    if (values.linked_account_id != null || values.payment_source === "linked_account_minimum") {
      errors.student_loan_payment_method =
        "The FHA deferred estimate cannot be used with a linked credit card.";
    }
    if (studentStatus !== "deferred" && studentStatus !== "forbearance") {
      errors.student_loan_status =
        "The FHA 0.5% estimate requires the loan to be deferred or in forbearance.";
    }
  }
  let monthly = MONEY_ZERO;
  if (studentMethod !== "fha_deferred_balance_percent" && values.payment_source === "manual") {
    if (isStudentLoan && values.monthly_payment.trim() === "") {
      errors.monthly_payment = "Enter a monthly payment for the manual or reported method.";
    } else {
      const amount = normalizeMoneyInput(values.monthly_payment);
      if (!amount.ok) errors.monthly_payment = amount.error;
      else monthly = amount.value;
    }
  }
  let balance: string | null = null;
  if (values.outstanding_balance.trim() !== "") {
    const parsed = normalizeMoneyInput(values.outstanding_balance);
    if (!parsed.ok) errors.outstanding_balance = parsed.error;
    else balance = parsed.value;
  }
  if (studentMethod === "fha_deferred_balance_percent") {
    if (balance == null || parseMoneyToCents(balance) === 0) {
      errors.outstanding_balance =
        "A positive outstanding balance is required for the FHA 0.5% estimate.";
    }
  }
  let months: number | null = null;
  if (values.months_remaining.trim() !== "") {
    const n = Number(values.months_remaining.trim());
    if (!Number.isInteger(n) || n <= 0) {
      errors.months_remaining = "Months remaining must be a positive whole number.";
    } else {
      months = n;
    }
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  const payload: DtiDebtItemWritePayload = {
    household_id: householdId,
    name,
    debt_type: values.debt_type,
    payment_source:
      studentMethod === "fha_deferred_balance_percent" ? "manual" : values.payment_source,
    included: values.included,
    notes: values.notes.trim(),
    outstanding_balance: balance,
    months_remaining: months,
    linked_account_id: isStudentLoan ? null : values.linked_account_id,
    student_loan_status: isStudentLoan ? studentStatus : null,
    student_loan_payment_method: isStudentLoan ? studentMethod : null,
  };
  if (studentMethod !== "fha_deferred_balance_percent" && values.payment_source === "manual") {
    payload.monthly_payment = monthly;
  }
  return { ok: true, payload };
}

export function alreadyLinkedAccountIds(
  debts: Array<Pick<DtiDebtItem, "id" | "linked_account_id">>,
  editingId?: number | null
): Set<number> {
  const ids = new Set<number>();
  for (const debt of debts) {
    if (editingId != null && debt.id === editingId) continue;
    if (debt.linked_account_id != null) ids.add(debt.linked_account_id);
  }
  return ids;
}

export function parseApiFieldErrors(err: unknown): { form: string; fields: Record<string, string> } {
  const message = err instanceof Error ? err.message : String(err);
  const fields: Record<string, string> = {};
  const parts = message.split(" — ");
  for (const part of parts) {
    const idx = part.indexOf(": ");
    if (idx > 0 && idx < 40) {
      const key = part.slice(0, idx).trim();
      const value = part.slice(idx + 2).trim();
      if (key && value && /^[a-z_]+$/.test(key)) fields[key] = value;
    }
  }
  return { form: message, fields };
}
