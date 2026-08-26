/** Display helpers mirroring web dashboard terminology (presentation only). */

export const DASHBOARD_SECTION = {
  financialHealth: "Financial Health",
  attention: "Attention Required",
  upcoming: "Upcoming money flow",
  goals: "Goals Progress",
  lookingAhead: "Looking ahead",
} as const;

export const FINANCIAL_HEALTH = {
  lowestProjectedCash: {
    label: "Lowest Forecast Balance",
    help: "The lowest projected balance among your active cash accounts during the selected forecast window.",
  },
  availableCash: {
    label: "Available Cash",
    subtitle: "Checking & savings available now",
  },
  availableCredit: {
    label: "Available Credit",
  },
  cashAfterDebt: {
    label: "Liquid Net Position",
    subtitle: "Available cash minus total debt",
  },
} as const;

export function lowestForecastBalanceLabel(days: number): string {
  if (days === 180) return "Lowest Forecast Balance (6 Months)";
  return `Lowest Forecast Balance (${days} Days)`;
}
