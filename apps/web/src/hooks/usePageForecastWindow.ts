import { useState } from "react";
import { useProfileQuery } from "../lib/profileQuery";
import {
  DEFAULT_OPERATIONAL_FORECAST_DAYS,
  normalizeOperationalForecastDays,
  type OperationalForecastDays,
} from "../lib/forecastWindow";

/**
 * Page-local Forecast Window initialized from the saved Settings default.
 * Changing the selector never writes the profile — only Settings save does that.
 */
export function usePageForecastWindow() {
  const { data: profile, isFetched, isError, isPending } = useProfileQuery();
  const [override, setOverride] = useState<OperationalForecastDays | null>(null);
  const ready = isFetched || isError;
  const savedDefault = ready
    ? normalizeOperationalForecastDays(profile?.default_forecast_days)
    : DEFAULT_OPERATIONAL_FORECAST_DAYS;
  const forecastDays = override ?? savedDefault;

  return {
    forecastDays,
    savedDefault,
    setForecastDays: (days: OperationalForecastDays) => {
      setOverride(normalizeOperationalForecastDays(days));
    },
    ready,
    profileLoading: isPending && !isFetched,
    profile,
  };
}
