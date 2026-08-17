import { useMemo } from "react";
import type { Account } from "@budget-app/shared";
import type { PassiveForecastDays } from "../../lib/safeToSpendLabels";
import { buildPortfolioForecastAlert } from "../../lib/accountForecastAlerts";

type Props = {
  accounts: Account[];
  forecastDays: PassiveForecastDays;
  onViewAccount: (accountId: number) => void;
  onResolveRisk?: (account: Account) => void;
};

/** Compact portfolio-level forecast alert (not a per-account Action Center). */
export default function AccountsForecastAlertsPanel({
  accounts,
  forecastDays,
  onViewAccount,
  onResolveRisk,
}: Props) {
  const alert = useMemo(
    () => buildPortfolioForecastAlert(accounts, forecastDays),
    [accounts, forecastDays]
  );

  if (accounts.length === 0) return null;

  if (!alert) {
    return (
      <p
        className="mb-4 text-xs text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2"
        data-testid="accounts-forecast-alerts-clear"
      >
        No accounts projected to go negative or over limit in the next {forecastDays} days.
      </p>
    );
  }

  const earliest = accounts.find((a) => a.id === alert.earliestAccountId);
  const handleAction = () => {
    if (alert.resolveSpendingRisk && earliest && onResolveRisk) {
      onResolveRisk(earliest);
      return;
    }
    onViewAccount(alert.earliestAccountId);
  };

  return (
    <div
      className="mb-4 rounded-lg border border-amber-200 bg-amber-50/90 px-3 py-2"
      data-testid="accounts-forecast-alerts"
      aria-label="Portfolio forecast alert"
    >
      <p className="text-sm font-semibold text-red-900">{alert.headline}</p>
      <p className="text-xs text-amber-950/90 mt-0.5">{alert.earliestLine}</p>
      <button
        type="button"
        onClick={handleAction}
        className="mt-1 text-xs text-blue-800 font-medium hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-600 rounded"
      >
        {alert.resolveSpendingRisk ? "Resolve risk →" : "View account →"}
      </button>
    </div>
  );
}
