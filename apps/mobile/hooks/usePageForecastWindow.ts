import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  DEFAULT_OPERATIONAL_FORECAST_DAYS,
  normalizeOperationalForecastDays,
  type OperationalForecastDays,
} from "@budget-app/shared";
import { getProfile } from "@budget-app/api-client";
import { useAuth } from "@/features/auth";

/**
 * Page-local forecast window seeded from profile.default_forecast_days.
 * Changing the selector does not persist (matches web Dashboard behavior).
 */
export function usePageForecastWindow() {
  const { auth } = useAuth();
  const profileQuery = useQuery({
    queryKey: ["profile"],
    queryFn: () => getProfile(),
    enabled: auth.isAuthenticated,
    initialData: auth.profile ?? undefined,
    staleTime: 60_000,
  });

  const profileDays = normalizeOperationalForecastDays(
    profileQuery.data?.default_forecast_days ?? DEFAULT_OPERATIONAL_FORECAST_DAYS
  );

  const [override, setOverride] = useState<OperationalForecastDays | null>(null);
  const forecastDays = override ?? profileDays;

  const ready = profileQuery.isFetched || profileQuery.isError || !!auth.profile;

  return useMemo(
    () => ({
      forecastDays,
      setForecastDays: (days: OperationalForecastDays) => setOverride(days),
      ready,
      profileDays,
    }),
    [forecastDays, ready, profileDays]
  );
}
