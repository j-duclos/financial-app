import { useMemo } from "react";
import type { Account } from "@budget-app/shared";
import type { PassiveForecastDays } from "../../lib/safeToSpendLabels";
import {
  buildAccountForecastAlerts,
  type AccountForecastAlert,
} from "../../lib/accountForecastAlerts";

type Props = {
  accounts: Account[];
  forecastDays: PassiveForecastDays;
  onViewAccount: (accountId: number) => void;
};

/** Compact forecast alerts (no large section header). */
export default function AccountsForecastAlertsPanel({
  accounts,
  forecastDays,
  onViewAccount,
}: Props) {
  const alerts = useMemo(
    () => buildAccountForecastAlerts(accounts, forecastDays),
    [accounts, forecastDays]
  );

  if (accounts.length === 0) return null;

  if (alerts.length === 0) {
    return (
      <p
        className="mb-4 text-xs text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2"
        data-testid="accounts-forecast-alerts-clear"
      >
        No accounts projected to go negative or over limit in the next {forecastDays} days.
      </p>
    );
  }

  return (
    <ul
      className="mb-4 rounded-lg border border-amber-200 bg-amber-50/90 divide-y divide-amber-200/80 overflow-hidden"
      data-testid="accounts-forecast-alerts"
      aria-label="Forecast alerts"
    >
      {alerts.map((alert) => (
        <AlertRow key={`${alert.accountId}-${alert.kind}`} alert={alert} onView={onViewAccount} />
      ))}
    </ul>
  );
}

function AlertRow({
  alert,
  onView,
}: {
  alert: AccountForecastAlert;
  onView: (accountId: number) => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={() => onView(alert.accountId)}
        className="w-full text-left px-3 py-2 hover:bg-amber-100 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-amber-600"
      >
        <span className="text-sm font-semibold text-red-900">{alert.headline}</span>
        <span className="text-xs text-amber-950/90 block sm:inline sm:ml-2 sm:mt-0 mt-0.5">
          {alert.detail}
        </span>
        <span className="text-xs text-blue-800 font-medium block sm:inline sm:ml-2 mt-1 sm:mt-0">
          View account →
        </span>
      </button>
    </li>
  );
}
