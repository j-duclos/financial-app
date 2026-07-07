import { formatCurrency } from "@budget-app/shared";
import type { Account } from "@budget-app/shared";
import AccountHealthBadge from "../AccountHealthBadge";
import { showSafeToSpendForRole } from "../../lib/safeToSpendLabels";
import { creditBalanceColorClass, formatDateDisplay } from "./transactionsLedgerUtils";

type Props = {
  account: Account;
  currentBalance: number;
  isCredit: boolean;
  currency: string;
  nextRiskDate: string | null;
  firstNegativeAmount: number | null;
  householdWarnings: { accountName: string; date: string; kind: "negative" | "credit_limit" }[];
  expanded: boolean;
  onToggle: () => void;
  /** When set, use forecast ledger rows (matches the table below the header). */
  ledgerLowestProjected?: number | null;
  ledgerLowestProjectedDate?: string | null;
};

export default function ForecastSummaryBar({
  account,
  currentBalance,
  isCredit,
  currency,
  nextRiskDate,
  firstNegativeAmount,
  householdWarnings,
  expanded,
  onToggle,
  ledgerLowestProjected,
  ledgerLowestProjectedDate,
}: Props) {
  const showForecastMetrics = showSafeToSpendForRole(account.role, account.account_type ?? "");
  const lowestProjected =
    ledgerLowestProjected ??
    (account.lowest_projected_balance_30_days != null
      ? parseFloat(account.lowest_projected_balance_30_days)
      : null);
  const lowestProjectedDate =
    ledgerLowestProjectedDate ?? account.lowest_projected_balance_date_30_days ?? null;
  const fmtBal = (bal: number) => formatCurrency(bal, currency);

  const earliestWarning = householdWarnings.length
    ? householdWarnings.reduce((a, b) => (a.date <= b.date ? a : b))
    : null;
  const riskDate = nextRiskDate ?? earliestWarning?.date ?? null;
  const riskValue =
    riskDate != null
      ? `${formatDateDisplay(riskDate)}${
          firstNegativeAmount != null
            ? ` (${formatCurrency(String(firstNegativeAmount), currency)})`
            : ""
        }`
      : "None";
  const lowestProjectedValue =
    lowestProjected != null
      ? `${formatCurrency(String(lowestProjected), currency)}${
          lowestProjectedDate != null ? ` on ${formatDateDisplay(lowestProjectedDate)}` : ""
        }`
      : "—";

  return (
    <div className="rounded-lg border border-slate-200 bg-gradient-to-r from-slate-50 to-white shadow-sm overflow-hidden">
      <div className="px-4 py-3">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          <SummaryMetric
            label="Current Balance"
            value={fmtBal(currentBalance)}
            prominent
            valueClass={creditBalanceColorClass(isCredit, currentBalance)}
          />
          <SummaryMetric
            label="Next Risk Date"
            value={riskValue}
            valueClass={riskDate ? "text-amber-800" : "text-gray-500"}
          />
          {showForecastMetrics && (
            <SummaryMetric
              label="Lowest Projected in Forecast Range"
              value={lowestProjectedValue}
              valueClass={
                lowestProjected != null && lowestProjected < 0
                  ? "text-red-700"
                  : "text-gray-900"
              }
            />
          )}
          <button
            type="button"
            onClick={onToggle}
            className="ml-auto text-sm font-medium text-blue-700 hover:text-blue-900 hover:underline"
            aria-expanded={expanded}
          >
            {expanded ? "Hide forecast" : "View forecast"}
          </button>
        </div>

        {expanded && (
          <div className="mt-4 pt-4 border-t border-slate-200 grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">Health</div>
              <AccountHealthBadge
                status={account.health_status ?? account.risk_status}
                reason={account.health_reason ?? account.risk_reason}
                account={account}
              />
            </div>
            <div>
              <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">Recommendation</div>
              <p className="text-sm text-gray-700">
                {account.health_recommended_action ?? account.risk_reason ?? "No action needed."}
              </p>
            </div>
          </div>
        )}
      </div>

      {householdWarnings.length > 0 && (
        <div className="px-4 py-2 bg-amber-50 border-t border-amber-200 text-xs text-amber-900">
          {householdWarnings.map((w, i) => (
            <span key={`${w.kind}-${w.accountName}-${w.date}`}>
              {i > 0 && " · "}
              {w.kind === "negative" ? (
                <>
                  <strong>{w.accountName}</strong> negative by {formatDateDisplay(w.date)}
                </>
              ) : (
                <>
                  <strong>{w.accountName}</strong> over limit by {formatDateDisplay(w.date)}
                </>
              )}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function SummaryMetric({
  label,
  value,
  prominent,
  valueClass = "text-gray-900",
}: {
  label: string;
  value: string;
  prominent?: boolean;
  valueClass?: string;
}) {
  return (
    <div>
      <div className="text-[10px] font-medium text-gray-500 uppercase tracking-wide">{label}</div>
      <div className={`${prominent ? "text-lg" : "text-base"} font-semibold tabular-nums ${valueClass}`}>{value}</div>
    </div>
  );
}