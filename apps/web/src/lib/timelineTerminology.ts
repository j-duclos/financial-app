/** Human-first copy for Calendar summary cards. */

export const CALENDAR_SUMMARY = {
  lowestProjectedBalance: {
    label: "Lowest projected",
    help: "The lowest combined ending balance from today through the end of your forecast—when cash is tightest ahead.",
  },
  nextRiskDate: {
    label: "Next risk date",
    help: "First upcoming day when projected balances look tight or dangerous based on your buffer.",
  },
  highestProjectedBalance: {
    label: "Highest projected balance",
    help: "The highest combined ending balance from today through the end of your forecast.",
  },
  upcomingIncomeExpenses: {
    label: "Upcoming income",
    help: "Total projected income and expenses from today through the end of your forecast.",
  },
  safeUntilNextIncome: {
    label: "Safe until next income",
    help: "Cash left after projected spending until your next income arrives.",
  },
} as const;
