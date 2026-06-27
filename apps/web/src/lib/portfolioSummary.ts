import type { Account } from "@budget-app/shared";
import {
  accountRole,
  computeGroupSummary,
  isDebtAccount,
  type AccountGroupSummary,
} from "./accountOrganization";

/** Matches dashboard snapshot savings bucket (spending vs savings split). */
export function isPortfolioSavingsAccount(acc: Account): boolean {
  if (isDebtAccount(acc)) return false;
  const role = accountRole(acc);
  if (role === "savings" || role === "emergency_fund" || role === "investment") return true;
  return (
    acc.account_type === "SAVINGS" ||
    acc.account_type === "INVESTMENT" ||
    acc.account_type === "RETIREMENT_401K"
  );
}

export interface PortfolioBucketSummary extends AccountGroupSummary {
  /** Primary balance for the tile (spending/savings totals or debt owed). */
  displayTotal: number;
}

export interface PortfolioSummary {
  spending: PortfolioBucketSummary;
  savings: PortfolioBucketSummary;
  debt: PortfolioBucketSummary;
  netPosition: number;
  currency: string;
}

function bucketSummary(accounts: Account[], debtBucket: boolean): PortfolioBucketSummary {
  const base = computeGroupSummary(accounts);
  const displayTotal = debtBucket ? base.totalDebt : base.totalBalance;
  return { ...base, displayTotal };
}

/** High-level portfolio totals from accounts already on the Accounts page. */
export function computePortfolioSummary(accounts: Account[]): PortfolioSummary {
  const spendingAccounts: Account[] = [];
  const savingsAccounts: Account[] = [];
  const debtAccounts: Account[] = [];

  for (const acc of accounts) {
    if (isDebtAccount(acc)) debtAccounts.push(acc);
    else if (isPortfolioSavingsAccount(acc)) savingsAccounts.push(acc);
    else spendingAccounts.push(acc);
  }

  const spending = bucketSummary(spendingAccounts, false);
  const savings = bucketSummary(savingsAccounts, false);
  const debt = bucketSummary(debtAccounts, true);

  return {
    spending,
    savings,
    debt,
    netPosition: spending.displayTotal + savings.displayTotal - debt.displayTotal,
    currency: spending.currency,
  };
}
