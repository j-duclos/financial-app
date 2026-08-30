import type { Account, RecurringRule } from "@budget-app/shared";

export const RULE_SECTIONS = [
  { key: "income", label: "Income" },
  { key: "bills", label: "Bills" },
  { key: "credit_card_charges", label: "Credit card charges" },
  { key: "card_loan_payments", label: "Credit Card / Loan Payment" },
  { key: "transfers", label: "Transfers" },
  { key: "subscriptions", label: "Subscriptions" },
] as const;

export type RuleSectionKey = (typeof RULE_SECTIONS)[number]["key"];

const SUBSCRIPTION_CATEGORY_NAMES = new Set(["Streaming", "Software / Apps", "Memberships"]);

const LOAN_PAYMENT_CATEGORY_NAMES = new Set(["Student Loan", "Personal Loan"]);

function categoryAllowsTransferDestination(rule: RecurringRule): boolean {
  const cat = rule.category;
  if (!cat) return false;
  if (typeof cat.allows_transfer_destination === "boolean") {
    return cat.allows_transfer_destination;
  }
  const code = cat.system_code ?? null;
  return code === "BANK_TRANSFER" || code === "CREDIT_CARD_PAYMENT";
}

function categoryIsCreditCardPayment(rule: RecurringRule): boolean {
  return rule.category?.system_code === "CREDIT_CARD_PAYMENT";
}

export function isCreditCardAccount(account: Pick<Account, "account_type"> | null | undefined): boolean {
  return String(account?.account_type ?? "").toUpperCase() === "CREDIT";
}

/** Expense charged to a credit card — not a cash outflow until the card is paid from a bank account. */
export function isCreditCardExpenseRule(rule: RecurringRule): boolean {
  return rule.direction === "EXPENSE" && isCreditCardAccount(rule.account);
}

export function getRuleSection(rule: RecurringRule): RuleSectionKey {
  if (rule.direction === "INCOME") return "income";
  const catName = rule.category?.name ?? "";
  const hasTransferDest = !!(rule.transfer_to_account?.id ?? rule.transfer_to_account_id);
  if (categoryIsCreditCardPayment(rule) || LOAN_PAYMENT_CATEGORY_NAMES.has(catName)) {
    return "card_loan_payments";
  }
  if (
    rule.direction === "TRANSFER" ||
    hasTransferDest ||
    categoryAllowsTransferDestination(rule)
  ) {
    return "transfers";
  }
  if (isCreditCardExpenseRule(rule)) return "credit_card_charges";
  if (SUBSCRIPTION_CATEGORY_NAMES.has(catName)) return "subscriptions";
  return "bills";
}

/**
 * Signed monthly equivalent (expenses negative) from backend estimated_monthly_amount.
 * Falls back to raw amount sign only when the API field is absent (legacy payloads).
 */
export function ruleMonthlyAmount(rule: RecurringRule): number {
  const fromApi = Number(rule.estimated_monthly_amount);
  if (
    Number.isFinite(fromApi) &&
    rule.estimated_monthly_amount != null &&
    rule.estimated_monthly_amount !== ""
  ) {
    return fromApi;
  }
  const amount = Math.abs(Number(rule.amount) || 0);
  return rule.direction === "EXPENSE" ? -amount : amount;
}

export function ruleCountsTowardMonthlyCashFlow(rule: RecurringRule): boolean {
  const section = getRuleSection(rule);
  if (section === "transfers" || section === "credit_card_charges") return false;
  return true;
}

export function sectionMonthlySubtotal(
  rules: RecurringRule[],
  isRunning: (rule: RecurringRule) => boolean
): number {
  return rules.reduce((sum, rule) => {
    if (!isRunning(rule)) return sum;
    return sum + ruleMonthlyAmount(rule);
  }, 0);
}

/** Income minus expenses from running rules; excludes internal transfers and credit card charges. */
export function estimatedMonthlyCashFlow(
  rules: RecurringRule[],
  isRunning: (rule: RecurringRule) => boolean
): number {
  return rules.reduce((sum, rule) => {
    if (!isRunning(rule)) return sum;
    if (!ruleCountsTowardMonthlyCashFlow(rule)) return sum;
    return sum + ruleMonthlyAmount(rule);
  }, 0);
}
