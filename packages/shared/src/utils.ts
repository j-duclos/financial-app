import type { Account, AccountRole, AccountType } from "./types";

/** User-facing account title (prefers custom display name). */
export function getEffectiveDisplayName(
  a: Pick<Account, "effective_display_name" | "display_name" | "nickname" | "name">
): string {
  const fromApi = (a.effective_display_name || "").trim();
  if (fromApi) return fromApi;
  const custom = (a.display_name || a.nickname || "").trim();
  if (custom) return custom;
  return (a.name || "").trim() || "Account";
}

/** Institution + account type subtitle (e.g. "Chase • Checking"). */
export function getAccountInstitutionSubtitle(
  a: Pick<Account, "institution" | "account_type">
): string {
  const inst = (a.institution || "").trim();
  const typeLabel = ACCOUNT_TYPE_LABELS[a.account_type] ?? a.account_type;
  if (inst) return `${inst} • ${typeLabel}`;
  return typeLabel;
}

/**
 * Unambiguous account label for dropdowns (name can duplicate across Plaid / manual accounts).
 */
export function formatAccountOptionLabel(
  a: Pick<
    Account,
    "id" | "name" | "display_name" | "nickname" | "effective_display_name" | "last_four" | "institution"
  >
): string {
  const digits = (a.last_four || "").replace(/\D/g, "");
  const mask = digits.length >= 4 ? digits.slice(-4) : "";
  const inst = (a.institution || "").trim();
  const parts: string[] = [getEffectiveDisplayName(a)];
  if (mask) parts.push(`···${mask}`);
  if (inst) parts.push(inst);
  return `${parts.join(" · ")} (#${a.id})`;
}

/**
 * Format amount with currency (minor units: 2 decimals).
 */
export function formatCurrency(amount: string | number, currency = "USD"): string {
  const n = typeof amount === "string" ? parseFloat(amount) : amount;
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

/**
 * Format year-month for display (e.g. "2025-01" -> "January 2025").
 */
export function formatMonth(year: number, month: number): string {
  const d = new Date(year, month - 1, 1);
  return d.toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

/**
 * Parse YYYY-MM string to { year, month }.
 */
export function parseMonth(monthStr: string): { year: number; month: number } {
  const [y, m] = monthStr.split("-").map(Number);
  return { year: y, month: m };
}

/**
 * Current month in YYYY-MM format.
 */
export function currentMonthStr(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

export const ACCOUNT_TYPE_LABELS: Record<string, string> = {
  CHECKING: "Checking",
  SAVINGS: "Savings",
  CREDIT: "Credit",
  CASH: "Cash",
  INVESTMENT: "Investment",
  RETIREMENT_401K: "401k",
  OTHER: "Other",
};

export const ACCOUNT_ROLE_LABELS: Record<AccountRole, string> = {
  spending: "Spending",
  bills: "Bills",
  savings: "Savings",
  emergency_fund: "Emergency Fund",
  credit_card: "Credit Card",
  loan: "Loan",
  investment: "Investment",
  cash_reserve: "Cash Reserve",
  other: "Other",
};

/** Default role when creating an account from its type (matches backend inference). */
export function inferAccountRoleFromType(accountType: AccountType): AccountRole {
  switch (accountType) {
    case "CHECKING":
      return "spending";
    case "SAVINGS":
      return "savings";
    case "CREDIT":
      return "credit_card";
    default:
      return "other";
  }
}

export const CATEGORY_TYPE_LABELS: Record<string, string> = {
  INCOME: "Income",
  EXPENSE: "Expense",
};
