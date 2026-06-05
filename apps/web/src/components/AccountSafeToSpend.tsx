import { formatCurrency } from "@budget-app/shared";
import type { Account, AccountRole } from "@budget-app/shared";
import { formatDateDisplay } from "../lib/dateDisplay";
import { riskStatusClass, riskStatusLabel, safeToSpendLabel, showSafeToSpendForRole } from "../lib/safeToSpendLabels";

type Props = {
  account: Account;
  role?: AccountRole;
  compact?: boolean;
  className?: string;
};

export function AccountSafeToSpend({ account, role, compact = false, className = "" }: Props) {
  const accountRole = role ?? account.role;
  if (!showSafeToSpendForRole(accountRole, account.account_type)) {
    return null;
  }

  const available = account.available_to_spend;
  if (available == null || available === "") {
    return null;
  }

  const availNum = parseFloat(available);
  const currency = account.currency ?? "USD";
  const label = safeToSpendLabel(accountRole);
  const lowest = account.lowest_projected_balance_30_days;
  const buffer = account.minimum_buffer ?? "0";
  const projected = account.projected_balance_30_days;
  const riskStatus = account.risk_status;
  const isNegative = !Number.isNaN(availNum) && availNum < 0;

  if (compact) {
    return (
      <div className={`text-xs space-y-0.5 ${className}`}>
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className="text-gray-500">{label}:</span>
          <span className={isNegative ? "font-semibold text-red-700" : "font-semibold text-gray-900"}>
            {formatCurrency(available, currency)}
          </span>
          {riskStatus ? (
            <span className={`inline-flex rounded px-1.5 py-0.5 text-[10px] font-medium ${riskStatusClass(riskStatus)}`}>
              {riskStatusLabel(riskStatus)}
            </span>
          ) : null}
        </div>
        {isNegative && account.risk_date ? (
          <p className="text-red-700">
            Not safe to spend — projected shortfall of {formatCurrency(String(Math.abs(availNum)), currency)} by{" "}
            {formatDateDisplay(account.risk_date)}.
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <div className={`rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm space-y-1 ${className}`}>
      <div className="font-medium text-slate-800">{account.name}</div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-0.5 text-slate-700">
        <div>
          <span className="text-slate-500">Current balance: </span>
          {formatCurrency(account.available_balance ?? account.balance ?? "0", currency)}
        </div>
        <div>
          <span className="text-slate-500">{label}: </span>
          <span className={isNegative ? "font-semibold text-red-700" : "font-semibold"}>
            {formatCurrency(available, currency)}
          </span>
        </div>
        {lowest != null ? (
          <div>
            <span className="text-slate-500">Lowest next 30 days: </span>
            {formatCurrency(lowest, currency)}
          </div>
        ) : null}
        <div>
          <span className="text-slate-500">Buffer: </span>
          {formatCurrency(buffer, currency)}
        </div>
        {projected != null ? (
          <div>
            <span className="text-slate-500">30-day projected: </span>
            {formatCurrency(projected, currency)}
          </div>
        ) : null}
        {riskStatus ? (
          <div className="flex items-center gap-2">
            <span className="text-slate-500">Status:</span>
            <span className={`inline-flex rounded px-2 py-0.5 text-xs font-medium ${riskStatusClass(riskStatus)}`}>
              {riskStatusLabel(riskStatus)}
            </span>
          </div>
        ) : null}
      </div>
      {isNegative ? (
        <p className="text-red-700 text-xs pt-1">
          Not safe to spend — projected shortfall of {formatCurrency(String(Math.abs(availNum)), currency)}
          {account.risk_date ? ` by ${formatDateDisplay(account.risk_date)}` : ""}.
        </p>
      ) : null}
    </div>
  );
}
