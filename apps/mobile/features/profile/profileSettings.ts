import type { QueryClient } from "@tanstack/react-query";
import type { UserProfile } from "@budget-app/api-client";
import {
  FORECAST_WINDOW_LABELS,
  OPERATIONAL_FORECAST_DAY_OPTIONS,
  type OperationalForecastDays,
} from "@budget-app/shared";
import { PROFILE_QUERY_KEY } from "@/lib/profileQueryKey";

/** Forecast-window changes affect operational views — not historical reports. */
export const FORECAST_PREFERENCE_QUERY_PREFIXES = [
  ["dashboard-summary"],
  ["dashboard-summary-fast"],
  ["dashboard-summary-details"],
  ["extended-cash-risk"],
  ["recommendations"],
  ["transactions"],
  ["timeline"],
  ["calendar-summary"],
  ["calendar-chunk"],
  ["accounts"],
  ["account"],
  ["debt-plan"],
] as const;

export function forecastWindowOptions(): {
  value: OperationalForecastDays;
  label: string;
}[] {
  return OPERATIONAL_FORECAST_DAY_OPTIONS.map((value) => ({
    value,
    label: FORECAST_WINDOW_LABELS[value],
  }));
}

export function applyUpdatedProfileCache(queryClient: QueryClient, profile: UserProfile): void {
  queryClient.setQueryData(PROFILE_QUERY_KEY, profile);
}

export function invalidateAfterForecastWindowChange(queryClient: QueryClient): void {
  void queryClient.invalidateQueries({ queryKey: PROFILE_QUERY_KEY });
  for (const queryKey of FORECAST_PREFERENCE_QUERY_PREFIXES) {
    void queryClient.invalidateQueries({ queryKey: [...queryKey] });
  }
}

/** True when About legal/support rows can be shown. */
export function hasConfiguredLegalLinks(opts: {
  privacyUrl: string | null;
  termsUrl: string | null;
  supportEmail: string | null;
}): boolean {
  return Boolean(opts.privacyUrl || opts.termsUrl || opts.supportEmail);
}

/** Dev-only environment line for Settings → Development. */
export function developmentEnvironmentLabel(opts: {
  appEnv: string;
  apiTarget: string;
}): string {
  const env =
    opts.appEnv === "development"
      ? "Development"
      : opts.appEnv === "staging"
        ? "Staging"
        : opts.appEnv === "production"
          ? "Production"
          : opts.appEnv;
  return `${env} · ${opts.apiTarget} API`;
}
