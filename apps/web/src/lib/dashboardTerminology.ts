/** Human-first copy for dashboard financial summary (not accounting jargon). */

export const DASHBOARD_SECTION = {
  financialHealth: "Financial Health",
  resourceBreakdown: "Resource Breakdown",
} as const;

export const FINANCIAL_HEALTH = {
  safeToSpend: {
    label: "Safe to Spend",
    help: "How much you can safely spend before projected cashflow problems occur.",
    healthySubtitle: "Spendable before projected risk",
  },
  availableCash: {
    label: "Available Cash",
    subtitle: "Checking & savings available now",
    help: "Cash in checking and savings accounts you can access today.",
  },
  availableCredit: {
    label: "Available Credit",
    subtitleSuffix: "across active credit accounts",
    help: "Remaining usable credit across active credit accounts, shown against total combined credit limits.",
  },
  cashAfterDebt: {
    label: "Cash After Debt",
    subtitle: "Available cash minus owed balances",
    help: "Available cash minus current debt balances. Not full net worth.",
  },
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
] as const;
