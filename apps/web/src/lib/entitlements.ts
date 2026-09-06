import type { BillingStatus } from "@budget-app/shared";
import { ApiError } from "@budget-app/api-client";
import { FREE_PLAN_LIMITS, PREMIUM_PLAN_FORECAST_DAYS } from "./billing";
import {
  OPERATIONAL_FORECAST_DAY_OPTIONS,
  type OperationalForecastDays,
} from "./forecastWindow";

export function isPremium(billing: BillingStatus | undefined | null): boolean {
  return billing?.is_premium === true || billing?.entitlements?.is_premium === true;
}

export function canUsePlaidBankSync(billing: BillingStatus | undefined | null): boolean {
  if (!billing) return false;
  if (billing.entitlements) return billing.entitlements.plaid_bank_sync === true;
  return billing.is_premium === true;
}

export function maxOperationalForecastDays(billing: BillingStatus | undefined | null): number {
  const fromServer = billing?.entitlements?.limits.operational_forecast_days;
  if (typeof fromServer === "number") return fromServer;
  return isPremium(billing) ? PREMIUM_PLAN_FORECAST_DAYS : FREE_PLAN_LIMITS.operational_forecast_days;
}

export function forecastOptionsForPlan(
  billing: BillingStatus | undefined | null
): OperationalForecastDays[] {
  const max = maxOperationalForecastDays(billing);
  return OPERATIONAL_FORECAST_DAY_OPTIONS.filter((days) => days <= max);
}

export function atPlanLimit(
  billing: BillingStatus | undefined | null,
  feature: "manual_accounts" | "recurring_rules" | "goals"
): boolean {
  if (isPremium(billing)) return false;
  const limit = billing?.entitlements?.limits[feature] ?? FREE_PLAN_LIMITS[feature];
  const usage = billing?.entitlements?.usage[feature];
  if (limit == null) return false;
  if (typeof usage !== "number") return false;
  return usage >= limit;
}

export function planLimit(feature: "manual_accounts" | "recurring_rules" | "goals"): number {
  return FREE_PLAN_LIMITS[feature];
}

export function isEntitlementError(error: unknown): error is ApiError {
  return (
    error instanceof ApiError &&
    (error.code === "premium_required" || error.code === "plan_limit_reached" || error.upgradeRequired === true)
  );
}
