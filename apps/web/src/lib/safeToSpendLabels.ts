import type { AccountRole } from "@budget-app/shared";

export const FORECAST_DAY_OPTIONS = [7, 14, 30, 60, 90] as const;
export type ForecastDays = (typeof FORECAST_DAY_OPTIONS)[number];

export function safeToSpendLabel(role: AccountRole | undefined): string {
  switch (role) {
    case "bills":
      return "Bills Covered";
    case "savings":
    case "emergency_fund":
      return "Available After Buffer";
    case "cash_reserve":
      return "Safe to Spend";
    default:
      return "Safe to Spend";
  }
}

export function riskStatusLabel(status: string | null | undefined): string {
  switch (status) {
    case "healthy":
      return "Healthy";
    case "watch":
      return "Watch";
    case "risk":
      return "At risk";
    case "critical":
      return "Critical";
    default:
      return "—";
  }
}

export function riskStatusClass(status: string | null | undefined): string {
  switch (status) {
    case "healthy":
      return "bg-green-100 text-green-800";
    case "watch":
      return "bg-amber-100 text-amber-800";
    case "risk":
      return "bg-orange-100 text-orange-800";
    case "critical":
      return "bg-red-100 text-red-800";
    default:
      return "bg-gray-100 text-gray-600";
  }
}

export function showSafeToSpendForRole(role: AccountRole | undefined, accountType: string): boolean {
  if (accountType === "CREDIT") return false;
  if (role === "credit_card" || role === "loan" || role === "investment") return false;
  return true;
}
