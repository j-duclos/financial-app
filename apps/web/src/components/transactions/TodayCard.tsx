import { formatCurrency } from "@budget-app/shared";
import AccountHealthBadge from "../AccountHealthBadge";
import { safeToSpendLabel, showSafeToSpendForRole } from "../../lib/safeToSpendLabels";
import { creditBalanceColorClass, formatDateDisplay, todayStr } from "./transactionsLedgerUtils";
import BalanceBufferBar from "./BalanceBufferBar";
import type { Account } from "@budget-app/shared";

type Props = {
  account: Account;
  currentBalance: number;
  isCredit: boolean;
  currency: string;
  availableCredit: number | null;
  availableCreditBreakdown: { limit: number; amountOwed: number } | null;
};

export default function TodayCard({
  account,
  currentBalance,
  isCredit,
  currency,
  availableCredit,
  availableCreditBreakdown,
}: Props) {
  const showSts = showSafeToSpendForRole(account.role, account.account_type ?? "");
  const sts = account.available_to_spend != null ? parseFloat(account.available_to_spend) : null;
  const fmtBal = (bal: number) => formatCurrency(isCredit ? Math.abs(bal) : bal, currency);
  const creditClass = creditBalanceColorClass(isCredit, currentBalance);

  return (
    <section className="flex-none border-y-4 border-blue-500 bg-blue-50/40">
      <header className="px-4 py-2 flex items-center justify-between gap-3 border-b border-blue-200">
        <div>
          <h2 className="text-sm font-bold text-blue-900 uppercase tracking-wide">Today</h2>
          <p className="text-xs text-blue-700">{formatDateDisplay(todayStr())}</p>
        </div>
      </header>

      <div className="px-4 py-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="rounded-lg bg-white border border-blue-100 p-4 shadow-sm">
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Current Balance</p>
          <p className={`text-2xl font-bold tabular-nums mt-1 ${creditClass}`}>{fmtBal(currentBalance)}</p>
        </div>

        {showSts && sts != null ? (
          <div className="rounded-lg bg-white border border-emerald-100 p-4 shadow-sm">
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">{safeToSpendLabel(account.role)}</p>
            <p className={`text-2xl font-bold tabular-nums mt-1 ${sts < 0 ? "text-red-700" : "text-emerald-800"}`}>
              {formatCurrency(sts, currency)}
            </p>
            {(account.health_status || account.risk_status) && (
              <div className="mt-2">
                <AccountHealthBadge
                  status={account.health_status ?? account.risk_status}
                  reason={account.health_reason ?? account.risk_reason}
                  compact
                />
              </div>
            )}
            {parseFloat(account.available_to_spend!) < 0 && account.risk_date && (
              <p className="text-xs text-red-700 mt-1">
                Shortfall by {formatDateDisplay(account.risk_date)}
              </p>
            )}
          </div>
        ) : isCredit && availableCredit != null ? (
          <div className="rounded-lg bg-white border border-slate-200 p-4 shadow-sm">
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Available Credit</p>
            <p className="text-2xl font-bold tabular-nums mt-1 text-green-600">
              {formatCurrency(availableCredit, currency)}
            </p>
            {availableCreditBreakdown && (
              <p className="text-xs text-gray-500 mt-1">
                Limit {formatCurrency(availableCreditBreakdown.limit, currency)} −{" "}
                {formatCurrency(availableCreditBreakdown.amountOwed, currency)} owed
              </p>
            )}
          </div>
        ) : null}
      </div>

      {showSts && (
        <div className="px-4 pb-4">
          <BalanceBufferBar
            currentBalance={currentBalance}
            safeToSpend={sts}
            minimumBuffer={account.minimum_buffer != null ? parseFloat(String(account.minimum_buffer)) : null}
            currency={currency}
            isCredit={isCredit}
          />
        </div>
      )}
    </section>
  );
}
