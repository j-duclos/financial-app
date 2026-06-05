import type { AccountRole } from "@budget-app/shared";
import { normalizeSeverity, severityLabel, severityTokens } from "./severity";

/** Default windows for dashboard, accounts, and other passive loads. */
export const PASSIVE_FORECAST_DAY_OPTIONS = [7, 14, 30] as const;

/** Extended windows for timeline, scenarios, and advanced tools (explicit user choice). */
export const EXTENDED_FORECAST_DAY_OPTIONS = [60, 90] as const;

export const FORECAST_DAY_OPTIONS = [
  ...PASSIVE_FORECAST_DAY_OPTIONS,
  ...EXTENDED_FORECAST_DAY_OPTIONS,
] as const;

export type PassiveForecastDays = (typeof PASSIVE_FORECAST_DAY_OPTIONS)[number];
export type ForecastDays = (typeof FORECAST_DAY_OPTIONS)[number];

export const DEFAULT_PASSIVE_FORECAST_DAYS: PassiveForecastDays = 30;

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
  if (!status) return "—";
  return severityLabel(normalizeSeverity(status));
}

export function riskStatusClass(status: string | null | undefined): string {
  if (!status) return "bg-gray-100 text-gray-600";
  return severityTokens(status).badgeClass;
}

export function showSafeToSpendForRole(role: AccountRole | undefined, accountType: string): boolean {
  if (accountType === "CREDIT") return false;
  if (role === "credit_card" || role === "loan" || role === "investment") return false;
  return true;
}
