import type { Account, RecurringRule } from "@budget-app/shared";

const SOURCE_ACCOUNT_TYPES = new Set(["CHECKING", "SAVINGS", "CASH"]);
const SAVINGS_ACCOUNT_TYPES = new Set(["SAVINGS", "CASH", "CHECKING"]);
const SAVINGS_ACCOUNT_ROLES = new Set([
  "savings",
  "emergency_fund",
  "cash_reserve",
  "spending",
  "bills",
]);
const ROLES_WITHOUT_AVAILABLE_TO_SPEND = new Set(["credit_card", "loan", "investment"]);

/** Mirrors backend account_supports_available_to_spend. */
export function accountSupportsAvailableToSpend(account: Account): boolean {
  if (ROLES_WITHOUT_AVAILABLE_TO_SPEND.has(account.role)) return false;
  if (account.account_type === "CREDIT") return false;
  return true;
}

export function isEligibleGuidedSourceAccount(account: Account): boolean {
  if (!account.is_active) return false;
  if (account.account_type === "CREDIT") return false;
  if (!SOURCE_ACCOUNT_TYPES.has(account.account_type)) return false;
  return accountSupportsAvailableToSpend(account);
}

export function isEligibleGuidedSavingsAccount(account: Account): boolean {
  if (!account.is_active) return false;
  if (account.account_type === "CREDIT") return false;
  if (SAVINGS_ACCOUNT_TYPES.has(account.account_type)) return true;
  return SAVINGS_ACCOUNT_ROLES.has(account.role) && accountSupportsAvailableToSpend(account);
}

export function isEligibleGuidedDebtAccount(account: Account): boolean {
  return account.is_active && account.account_type === "CREDIT";
}

export function ruleSourceAccountId(rule: RecurringRule): number | null {
  const id = rule.account_id ?? rule.account?.id;
  return id != null ? Number(id) : null;
}

export function ruleTransferDestinationId(rule: RecurringRule): number | null {
  const id = rule.transfer_to_account_id ?? rule.transfer_to_account?.id;
  return id != null ? Number(id) : null;
}

/** Mirrors backend rule_is_eligible_savings_transfer (IDs only — not names). */
export function isEligibleSavingsTransferRule(
  rule: RecurringRule,
  sourceAccountId: number,
  savingsAccountId: number
): boolean {
  if (ruleSourceAccountId(rule) !== sourceAccountId) return false;
  const destId = ruleTransferDestinationId(rule);
  if (destId == null) return false;
  return destId === savingsAccountId;
}

export function eligibleGuidedSourceAccounts(accounts: Account[]): Account[] {
  return accounts.filter(isEligibleGuidedSourceAccount);
}

export function eligibleGuidedSavingsAccounts(
  accounts: Account[],
  sourceAccountId: number | null
): Account[] {
  return accounts.filter(
    (account) =>
      isEligibleGuidedSavingsAccount(account) &&
      (sourceAccountId == null || account.id !== sourceAccountId)
  );
}

export function eligibleGuidedDebtAccounts(accounts: Account[]): Account[] {
  return accounts.filter(isEligibleGuidedDebtAccount);
}

export function eligibleSavingsTransferRules(
  rules: RecurringRule[],
  sourceAccountId: number | null,
  savingsAccountId: number | null
): RecurringRule[] {
  if (sourceAccountId == null || savingsAccountId == null) return [];
  return rules.filter((rule) =>
    isEligibleSavingsTransferRule(rule, sourceAccountId, savingsAccountId)
  );
}
