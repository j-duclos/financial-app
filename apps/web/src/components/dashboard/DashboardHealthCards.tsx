import { Link } from "react-router-dom";
import { formatCurrency } from "@budget-app/shared";
import type { DashboardSummary } from "@budget-app/shared";
import { formatHealthRiskDate } from "../../lib/accountHealthDisplay";
import { attentionLedgerPath, attentionLedgerState } from "../../lib/attentionCardDisplay";

function SafeToSpendCard({ safeToSpend }: { safeToSpend: DashboardSummary["safe_to_spend"] }) {
  const amount = parseFloat(safeToSpend.amount);
  const isCritical = safeToSpend.status === "critical" || amount < 0;

  return (
    <div className="bg-white rounded-lg shadow p-3">
      <p className="text-xs text-gray-500">Safe to Spend</p>
      <p
        className={`text-lg font-semibold leading-tight ${
          isCritical ? "text-red-700" : amount >= 0 ? "text-emerald-800" : "text-red-700"
        }`}
      >
        {formatCurrency(safeToSpend.amount)}
      </p>
      <p className="text-xs text-gray-500 mt-0.5">{safeToSpend.window_days}-day window</p>
      {isCritical && (
        <p className="text-xs text-red-700 font-medium mt-1">Critical — negative safe-to-spend</p>
      )}
      {!isCritical && (
        <p className="text-xs text-gray-500 mt-0.5">Spending & bills accounts</p>
      )}
    </div>
  );
}

function NetWorthCard({ netWorth }: { netWorth: string }) {
  return (
    <div className="bg-white rounded-lg shadow p-3">
      <p className="text-xs text-gray-500">Net Cash Worth</p>
      <p className="text-lg font-semibold leading-tight">{formatCurrency(netWorth)}</p>
      <p className="text-xs text-gray-500 mt-0.5">Cash & assets minus debts</p>
    </div>
  );
}

function NextRiskCard({
  safeToSpend,
}: {
  safeToSpend: DashboardSummary["safe_to_spend"];
}) {
  const nextIssue = safeToSpend.next_issue;

  if (!nextIssue) {
    return (
      <div className="bg-white rounded-lg shadow p-3">
        <p className="text-xs text-gray-500">Next Risk</p>
        <p className="text-sm text-gray-700 mt-1">No projected risks in this window</p>
        <p className="text-xs text-gray-500 mt-0.5">Based on account health forecasts</p>
      </div>
    );
  }

  const dateLabel = nextIssue.risk_date ? formatHealthRiskDate(nextIssue.risk_date) : null;

  return (
    <div className="bg-white rounded-lg shadow p-3">
      <p className="text-xs text-gray-500">Next Risk</p>
      <p className="text-sm font-semibold text-gray-900 mt-0.5 truncate">{nextIssue.account_name}</p>
      {dateLabel && <p className="text-xs text-amber-800 mt-0.5">{dateLabel}</p>}
      <p className="text-xs text-gray-600 mt-0.5 line-clamp-2">{nextIssue.reason}</p>
      <Link
        to={attentionLedgerPath(nextIssue.account_id)}
        state={attentionLedgerState(nextIssue.account_id)}
        className="inline-block text-xs text-blue-600 hover:underline mt-1"
      >
        Open ledger
      </Link>
    </div>
  );
}

export default function DashboardHealthCards({ summary }: { summary: DashboardSummary }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
      <SafeToSpendCard safeToSpend={summary.safe_to_spend} />
      <NetWorthCard netWorth={summary.net_worth} />
      <NextRiskCard safeToSpend={summary.safe_to_spend} />
    </div>
  );
}

export { SafeToSpendCard, NetWorthCard, NextRiskCard };
