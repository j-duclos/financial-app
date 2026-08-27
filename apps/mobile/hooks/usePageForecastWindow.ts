import { useMemo, useState } from "react";
import {
  DEFAULT_OPERATIONAL_FORECAST_DAYS,
  normalizeOperationalForecastDays,
  type OperationalForecastDays,
} from "@budget-app/shared";
import { useAuth } from "@/features/auth";
import { useProfile } from "@/lib/profileQuery";

/**
 * Page-local forecast window seeded from profile.default_forecast_days.
 * Changing the selector does not persist (matches web Dashboard behavior).
 */
export function usePageForecastWindow() {
  const { auth } = useAuth();
  const { data: profile } = useProfile();

  const profileDays = normalizeOperationalForecastDays(
    profile?.default_forecast_days ?? DEFAULT_OPERATIONAL_FORECAST_DAYS
  );

  const [override, setOverride] = useState<OperationalForecastDays | null>(null);
  const forecastDays = override ?? profileDays;

  // Authenticated shell can render dashboard requests immediately using the
  // canonical default until profile.default_forecast_days arrives.
  const ready = auth.isAuthenticated;

  return useMemo(
    () => ({
      forecastDays,
      setForecastDays: (days: OperationalForecastDays) =>
        setOverride(normalizeOperationalForecastDays(days)),
      ready,
      profileDays,
    }),
    [forecastDays, ready, profileDays]
  );
}
