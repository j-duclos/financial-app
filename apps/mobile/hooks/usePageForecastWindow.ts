import { useMemo, useState } from "react";
import {
  DEFAULT_OPERATIONAL_FORECAST_DAYS,
  clampForecastDaysForPlan,
  forecastOptionsForPlan,
  normalizeOperationalForecastDays,
  type OperationalForecastDays,
} from "@budget-app/shared";
import { useAuth } from "@/features/auth";
import { useProfile } from "@/lib/profileQuery";
import { useBillingStatus } from "./useBillingStatus";

/**
 * Page-local forecast window seeded from profile.default_forecast_days.
 * Changing the selector does not persist (matches web Dashboard behavior).
 * Saved Premium windows are clamped to the current plan for requests — the
 * profile value is not overwritten here.
 */
export function usePageForecastWindow() {
  const { auth } = useAuth();
  const { data: profile } = useProfile();
  const { billing } = useBillingStatus();

  const allowed = forecastOptionsForPlan(billing);
  const savedDefault = normalizeOperationalForecastDays(
    profile?.default_forecast_days ?? DEFAULT_OPERATIONAL_FORECAST_DAYS
  );
  const effectiveSaved = clampForecastDaysForPlan(savedDefault, billing);

  const [override, setOverride] = useState<OperationalForecastDays | null>(null);
  const requested = override ?? savedDefault;
  const forecastDays = allowed.includes(requested)
    ? requested
    : effectiveSaved;

  // Authenticated shell can render dashboard requests immediately using the
  // canonical default until profile.default_forecast_days arrives.
  const ready = auth.isAuthenticated;

  return useMemo(
    () => ({
      forecastDays,
      setForecastDays: (days: OperationalForecastDays) => {
        const next = normalizeOperationalForecastDays(days);
        setOverride(allowed.includes(next) ? next : effectiveSaved);
      },
      ready,
      profileDays: effectiveSaved,
    }),
    [allowed, effectiveSaved, forecastDays, ready]
  );
}
