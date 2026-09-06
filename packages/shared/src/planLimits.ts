import type { BillingStatus } from "./types";
import {
  DEFAULT_OPERATIONAL_FORECAST_DAYS,
  FORECAST_WINDOW_LABELS,
  OPERATIONAL_FORECAST_DAY_OPTIONS,
  normalizeOperationalForecastDays,
  type OperationalForecastDays,
} from "./forecastWindow";

/** Launch Free-plan caps. Backend entitlement rules remain authoritative. */
export const FREE_PLAN_LIMITS = {
  linked_institutions: 0,
  manual_accounts: 3,
  recurring_rules: 10,
  operational_forecast_days: 90,
  goals: 2,
} as const;

export const PREMIUM_PLAN_FORECAST_DAYS = 365;

export const PLAID_PREMIUM_MESSAGE =
  "Automatic bank syncing is available with Premium.";

export type PlanLimitedFeature = "manual_accounts" | "recurring_rules" | "goals";

export function isPremium(billing: BillingStatus | undefined | null): boolean {
  return billing?.is_premium === true || billing?.entitlements?.is_premium === true;
}

export function canUsePlaidBankSync(billing: BillingStatus | undefined | null): boolean {
  if (!billing) return false;
  if (billing.entitlements) return billing.entitlements.plaid_bank_sync === true;
  return billing.is_premium === true;
}

/**
 * Max operational forecast window the current plan may request.
 * Unknown billing is treated as Free so clients do not fire forbidden 365-day requests.
 */
export function maxOperationalForecastDays(billing: BillingStatus | undefined | null): number {
  const fromServer = billing?.entitlements?.limits.operational_forecast_days;
  if (typeof fromServer === "number") return fromServer;
  return isPremium(billing) ? PREMIUM_PLAN_FORECAST_DAYS : FREE_PLAN_LIMITS.operational_forecast_days;
}

/** Selectable (unlocked) operational windows for the current plan. */
export function forecastOptionsForPlan(
  billing: BillingStatus | undefined | null
): OperationalForecastDays[] {
  const max = maxOperationalForecastDays(billing);
  return OPERATIONAL_FORECAST_DAY_OPTIONS.filter((days) => days <= max);
}

export function clampForecastDaysForPlan(
  days: number,
  billing: BillingStatus | undefined | null
): OperationalForecastDays {
  const allowed = forecastOptionsForPlan(billing);
  const normalized = normalizeOperationalForecastDays(days);
  if (allowed.includes(normalized)) return normalized;
  return allowed[allowed.length - 1] ?? DEFAULT_OPERATIONAL_FORECAST_DAYS;
}

export function isForecastDaysAllowed(
  days: number,
  billing: BillingStatus | undefined | null
): boolean {
  return forecastOptionsForPlan(billing).includes(normalizeOperationalForecastDays(days));
}

export type ForecastPickerRow = {
  days: OperationalForecastDays;
  label: string;
  locked: boolean;
};

/**
 * Full operational picker including Premium upsell rows.
 * Locked rows must remain visible but must not submit a forecast request.
 */
export function forecastPickerRows(
  billing: BillingStatus | undefined | null
): ForecastPickerRow[] {
  const max = maxOperationalForecastDays(billing);
  return OPERATIONAL_FORECAST_DAY_OPTIONS.map((days) => ({
    days,
    label: FORECAST_WINDOW_LABELS[days],
    locked: days > max,
  }));
}

export function lockedForecastUpsellMessage(days: number): string {
  if (days >= PREMIUM_PLAN_FORECAST_DAYS) {
    return "365-day forecasts are available with Premium.";
  }
  return `${forecastWindowLabelSafe(days)} forecasts are available with Premium.`;
}

function forecastWindowLabelSafe(days: number): string {
  const normalized = normalizeOperationalForecastDays(days);
  return FORECAST_WINDOW_LABELS[normalized];
}

export function atPlanLimit(
  billing: BillingStatus | undefined | null,
  feature: PlanLimitedFeature
): boolean {
  if (isPremium(billing)) return false;
  const limit = billing?.entitlements?.limits[feature] ?? FREE_PLAN_LIMITS[feature];
  const usage = billing?.entitlements?.usage[feature];
  if (limit == null) return false;
  if (typeof usage !== "number") return false;
  return usage >= limit;
}

export function planLimit(feature: PlanLimitedFeature): number {
  return FREE_PLAN_LIMITS[feature];
}

export function manualAccountUsageLabel(
  billing: BillingStatus | undefined | null
): string | null {
  if (isPremium(billing)) return null;
  const limit = billing?.entitlements?.limits.manual_accounts ?? FREE_PLAN_LIMITS.manual_accounts;
  const usage = billing?.entitlements?.usage.manual_accounts;
  if (limit == null || typeof usage !== "number") return null;
  return `${usage} of ${limit} manual accounts`;
}

export function manualAccountLimitReachedMessage(
  billing: BillingStatus | undefined | null
): string {
  const limit = billing?.entitlements?.limits.manual_accounts ?? FREE_PLAN_LIMITS.manual_accounts;
  return `You've reached the Free plan limit of ${limit} manual accounts.`;
}
