import { useState } from "react";
import { useProfileQuery } from "../lib/profileQuery";
import {
  DEFAULT_OPERATIONAL_FORECAST_DAYS,
  normalizeOperationalForecastDays,
  type OperationalForecastDays,
} from "../lib/forecastWindow";
import { forecastOptionsForPlan } from "../lib/entitlements";
import { useBillingStatus } from "./useBillingStatus";

/**
 * Page-local Forecast Window initialized from the saved Settings default.
 * Changing the selector never writes the profile — only Settings save does that.
 */
export function usePageForecastWindow() {
  const { data: profile, isFetched, isError, isPending } = useProfileQuery();
  const { billing } = useBillingStatus();
  const [override, setOverride] = useState<OperationalForecastDays | null>(null);
  const ready = isFetched || isError;
  const allowed = forecastOptionsForPlan(billing);
  const savedDefault = ready
    ? normalizeOperationalForecastDays(profile?.default_forecast_days)
    : DEFAULT_OPERATIONAL_FORECAST_DAYS;
  const clampedSaved = allowed.includes(savedDefault)
    ? savedDefault
    : (allowed[allowed.length - 1] ?? DEFAULT_OPERATIONAL_FORECAST_DAYS);
  const requested = override ?? savedDefault;
  const forecastDays = allowed.includes(requested)
    ? requested
    : (allowed[allowed.length - 1] ?? DEFAULT_OPERATIONAL_FORECAST_DAYS);

  return {
    forecastDays,
    savedDefault: clampedSaved,
    setForecastDays: (days: OperationalForecastDays) => {
      const next = normalizeOperationalForecastDays(days);
      setOverride(allowed.includes(next) ? next : clampedSaved);
    },
    ready,
    profileLoading: isPending && !isFetched,
    profile,
  };
}
