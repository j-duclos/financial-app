import { formatCurrency, getEffectiveDisplayName } from "@budget-app/shared";
import type { Account } from "@budget-app/shared";
import AccountHealthBadge from "../AccountHealthBadge";
import { safeToSpendLabel, showSafeToSpendForRole } from "../../lib/safeToSpendLabels";
import type { AccountRole } from "@budget-app/shared";
import type { ForecastDays } from "../../lib/safeToSpendLabels";

type Props = {
  open: boolean;
  account: Account | null;
  role: AccountRole;
  forecastDays: ForecastDays;
  onClose: () => void;
  onViewLedger: () => void;
  onSchedule?: () => void;
  onViewUpcoming?: () => void;
};

export default function AccountForecastPanel({
  open,
  account,
  role,
  forecastDays,
  onClose,
  onViewLedger,
  onSchedule,
  onViewUpcoming,
}: Props) {
  if (!open || !account) return null;

  const health = account.health_status ?? account.risk_status;
  const showSafe = showSafeToSpendForRole(role, account.account_type);
  const isCredit = account.account_type === "CREDIT";

  return (
    <div className="fixed inset-0 z-40 flex items-end sm:items-center justify-center bg-black/50 p-0 sm:p-4">
      <div
        role="dialog"
        aria-modal="true"
        className="bg-white w-full sm:max-w-md rounded-t-xl sm:rounded-lg shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-4 border-b flex items-center justify-between">
          <h2 className="text-lg font-semibold">{forecastDays}-day forecast</h2>
          <button type="button" onClick={onClose} className="text-sm text-gray-500">
            Close
          </button>
        </div>
        <div className="p-4 space-y-4">
          <p className="text-sm font-medium text-gray-900">{getEffectiveDisplayName(account)}</p>
          {health ? (
            <AccountHealthBadge
              status={health}
              reason={account.health_reason ?? account.risk_reason}
              account={account}
              inline
            />
          ) : null}
          {account.health_recommended_action ? (
            <p className="text-sm text-amber-800 bg-amber-50 rounded p-2">
              {account.health_recommended_action}
            </p>
          ) : null}
          <dl className="grid grid-cols-2 gap-3 text-sm">
            {showSafe && account.available_to_spend != null ? (
              <>
                <dt className="text-gray-500">{safeToSpendLabel(role)}</dt>
                <dd className="font-semibold text-right tabular-nums">
                  {formatCurrency(account.available_to_spend, account.currency)}
                </dd>
              </>
            ) : null}
            {account.lowest_projected_balance_30_days != null ? (
              <>
                <dt className="text-gray-500">Lowest projected ({forecastDays}d)</dt>
                <dd
                  className={`font-semibold text-right tabular-nums ${
                    parseFloat(account.lowest_projected_balance_30_days) < 0 ? "text-red-700" : ""
                  }`}
                >
                  {formatCurrency(account.lowest_projected_balance_30_days, account.currency)}
                </dd>
              </>
            ) : null}
            {(account.health_risk_date ?? account.risk_date) ? (
              <>
                <dt className="text-gray-500">Risk date</dt>
                <dd className="text-right">{account.health_risk_date ?? account.risk_date}</dd>
              </>
            ) : null}
            {isCredit && account.utilization_percent != null ? (
              <>
                <dt className="text-gray-500">Utilization</dt>
                <dd className="text-right">{account.utilization_percent}%</dd>
              </>
            ) : null}
            {isCredit && account.statement_balance ? (
              <>
                <dt className="text-gray-500">Statement balance</dt>
                <dd className="text-right tabular-nums">
                  {formatCurrency(account.statement_balance, account.currency)}
                </dd>
              </>
            ) : null}
            {account.upcoming_inflows_30_days ? (
              <>
                <dt className="text-gray-500">Upcoming inflows</dt>
                <dd className="text-right text-green-700 tabular-nums">
                  {formatCurrency(account.upcoming_inflows_30_days, account.currency)}
                </dd>
              </>
            ) : null}
            {account.upcoming_outflows_30_days ? (
              <>
                <dt className="text-gray-500">Upcoming outflows</dt>
                <dd className="text-right text-red-700 tabular-nums">
                  {formatCurrency(account.upcoming_outflows_30_days, account.currency)}
                </dd>
              </>
            ) : null}
          </dl>
          <div className="flex flex-wrap gap-2 justify-end pt-2">
            {onViewUpcoming ? (
              <button
                type="button"
                onClick={onViewUpcoming}
                className="py-2 px-4 border border-gray-300 rounded text-sm text-gray-800 hover:bg-gray-50"
              >
                Upcoming activity
              </button>
            ) : null}
            {onSchedule ? (
              <button
                type="button"
                onClick={onSchedule}
                className="py-2 px-4 border border-gray-300 rounded text-sm text-gray-800 hover:bg-gray-50"
              >
                Schedule
              </button>
            ) : null}
            <button
              type="button"
              onClick={onViewLedger}
              className="py-2 px-4 bg-blue-600 text-white rounded text-sm hover:bg-blue-700"
            >
              Open ledger
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
