/** Operational Forecast Window for Dashboard, Action Center, and Transactions. */

export const OPERATIONAL_FORECAST_DAY_OPTIONS = [30, 60, 90, 180] as const;

export type OperationalForecastDays = (typeof OPERATIONAL_FORECAST_DAY_OPTIONS)[number];

export const DEFAULT_OPERATIONAL_FORECAST_DAYS: OperationalForecastDays = 30;

export const FORECAST_WINDOW_LABELS: Record<OperationalForecastDays, string> = {
  30: "30 days",
  60: "60 days",
  90: "90 days",
  180: "6 months",
};

export function isOperationalForecastDays(value: number): value is OperationalForecastDays {
  return (OPERATIONAL_FORECAST_DAY_OPTIONS as readonly number[]).includes(value);
}

/** Clamp a saved or requested window to 30 / 60 / 90 / 180. */
export function normalizeOperationalForecastDays(
  days: number | null | undefined
): OperationalForecastDays {
  if (typeof days === "number" && isOperationalForecastDays(days)) return days;
  return DEFAULT_OPERATIONAL_FORECAST_DAYS;
}

export function forecastWindowLabel(days: number): string {
  const normalized = normalizeOperationalForecastDays(days);
  return FORECAST_WINDOW_LABELS[normalized];
}
