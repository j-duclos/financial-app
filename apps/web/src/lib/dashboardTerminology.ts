/** Human-first copy for dashboard financial summary (not accounting jargon). */

export const DASHBOARD_SECTION = {
  financialHealth: "Financial Health",
  resourceBreakdown: "Resource Breakdown",
} as const;

export const FINANCIAL_HEALTH = {
  lowestProjectedCash: {
    label: "Lowest Forecast Balance",
    help: "The lowest projected balance among your active cash accounts during the selected forecast window. This is the worst point in the window, not the first time an account goes below zero.",
  },
  availableCash: {
    label: "Available Cash",
    subtitle: "Checking & savings available now",
    help: "Sum of current ledger balances in checking, savings, and cash accounts. Excludes bills pools, credit cards, loans, and investments.",
  },
  availableCredit: {
    label: "Available Credit",
    subtitleSuffix: "across active credit accounts",
    help: "Remaining usable credit across active credit accounts, shown against total combined credit limits.",
  },
  cashAfterDebt: {
    label: "Liquid Net Position",
    subtitle: "Available cash minus total debt",
    help: "Available cash minus current total debt (available cash − total debt). This is a current snapshot, not a forecasted balance.",
  },
} as const;

export const FIRST_CASH_SHORTFALL = {
  label: "First Cash Shortfall",
  help: "The earliest date an active cash account is projected to fall below zero in the selected forecast window.",
  amountLabel: "Projected balance",
} as const;

export const RESOURCE_BREAKDOWN = {
  spendingAccounts: {
    label: "Spending Accounts",
    subtitle: "Checking & bill accounts",
    help: "Daily-use accounts for spending and bills.",
  },
  debtOwed: {
    label: "Debt Owed",
    subtitle: "Cards & loans",
    help: "Current balances owed on credit cards and loans.",
  },
  savingsInvestments: {
    label: "Savings & Investments",
    subtitle: "Emergency funds & savings goals",
    help: "Savings, emergency funds, and investment-type accounts.",
  },
} as const;

/** Future: net worth when asset tracking exists. */
export const DASHBOARD_FUTURE_METRICS = {
  netWorth: "Net Worth",
} as const;

/** Legacy labels that must not appear in user-facing dashboard copy. */
export const DEPRECATED_DASHBOARD_LABELS = [
  "Net Position",
  "Liquid Cash",
  "Financial Snapshot",
  "Cash After Debt",
  "Lowest Projected Cash",
  "Next cash risk",
] as const;

export function lowestForecastBalanceLabel(days: number): string {
  if (days === 180) return "Lowest Forecast Balance (6 Months)";
  return `Lowest Forecast Balance (${days} Days)`;
}
