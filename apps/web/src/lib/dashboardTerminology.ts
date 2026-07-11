/** Human-first copy for dashboard financial summary (not accounting jargon). */

export const DASHBOARD_SECTION = {
  financialHealth: "Financial Health",
  resourceBreakdown: "Resource Breakdown",
} as const;

export const FINANCIAL_HEALTH = {
  lowestProjectedCash: {
    label: "Lowest Projected Cash",
    negativeLabel: "Projected Cash Shortfall",
    help: "The lowest projected balance among your cash accounts during the forecast window — one account on one date. Not adjusted for buffers or goal reserves.",
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
