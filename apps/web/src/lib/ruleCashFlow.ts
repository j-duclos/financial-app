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

const CARD_LOAN_PAYMENT_CATEGORY_NAMES = new Set([
  "Credit Card Payment",
  "Student Loan",
  "Personal Loan",
]);

const TRANSFER_CATEGORY_NAMES = new Set(["Bank Transfer", "Transfer"]);

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
  const nameLower = (rule.name ?? "").toLowerCase();
  if (CARD_LOAN_PAYMENT_CATEGORY_NAMES.has(catName)) return "card_loan_payments";
  if (
    rule.direction === "TRANSFER" ||
    hasTransferDest ||
    TRANSFER_CATEGORY_NAMES.has(catName) ||
    nameLower.includes("move to")
  ) {
    return "transfers";
  }
  if (isCreditCardExpenseRule(rule)) return "credit_card_charges";
  if (SUBSCRIPTION_CATEGORY_NAMES.has(catName)) return "subscriptions";
  return "bills";
}

/** Signed monthly equivalent (expenses negative) for running budget subtotals. */
export function ruleMonthlyAmount(rule: RecurringRule): number {
  const amount = Math.abs(Number(rule.amount) || 0);
  const interval = Math.max(1, Number(rule.interval) || 1);
  let perMonth: number;
  switch (rule.frequency) {
    case "WEEKLY":
      perMonth = (52 / 12 / interval) * amount;
      break;
    case "BIWEEKLY":
      perMonth = (26 / 12 / interval) * amount;
      break;
    case "MONTHLY_DAY":
    case "MONTHLY_NTH_WEEKDAY":
      perMonth = amount / interval;
      break;
    case "YEARLY":
      perMonth = amount / (12 * interval);
      break;
    default:
      perMonth = amount / interval;
  }
  return rule.direction === "EXPENSE" ? -perMonth : perMonth;
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
