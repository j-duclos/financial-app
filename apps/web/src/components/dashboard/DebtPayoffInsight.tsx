import { Link } from "react-router-dom";
import type { DashboardDebtSummary } from "@budget-app/shared";
import { formatCurrency } from "@budget-app/shared";

const INTEREST_TOOLTIP =
  "Estimated interest is based on current balances and APRs. Open Payment Planner for a full payoff projection.";

type Props = {
  debt: DashboardDebtSummary;
  /** Compact tile for the financial health grid. */
  grid?: boolean;
};

export default function DebtPayoffInsight({ debt, grid = false }: Props) {
  if (!debt.total_debt || parseFloat(debt.total_debt) <= 0) {
    return null;
  }
  const url = debt.planner_url?.startsWith("/") ? debt.planner_url : "/credit-cards";

  if (grid) {
    return (
      <div className="flex h-full min-h-[4.5rem] flex-col justify-between rounded-lg border border-indigo-200 bg-gradient-to-br from-indigo-50 to-white px-2.5 py-2 sm:px-3 sm:py-2.5">
        <p className="text-[9px] sm:text-[10px] font-semibold uppercase tracking-wide text-indigo-700 truncate">
          Debt payoff
        </p>
        <p className="text-base sm:text-lg md:text-xl font-semibold leading-tight text-indigo-950 line-clamp-2">
          {formatCurrency(debt.total_debt)} owed
        </p>
        <div className="space-y-0.5">
          {debt.label && debt.label !== "Open planner for payoff date" ? (
            <p className="text-[10px] sm:text-xs text-indigo-800 line-clamp-2">{debt.label}</p>
          ) : null}
          {debt.message ? (
            <p className="text-[10px] sm:text-xs text-indigo-800 line-clamp-2">{debt.message}</p>
          ) : null}
          <p
            className="text-[10px] sm:text-xs text-gray-600 line-clamp-1"
            title={INTEREST_TOOLTIP}
          >
            Est. {formatCurrency(debt.monthly_interest_burn)}/mo interest
          </p>
          <Link
            to={url}
            className="inline-block text-[10px] sm:text-xs font-medium text-indigo-700 hover:underline"
          >
            Payment Planner →
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-gradient-to-br from-indigo-50 to-white border border-indigo-200 rounded-lg p-3 space-y-1">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold text-indigo-950">
          {formatCurrency(debt.total_debt)} owed
        </p>
        <Link to={url} className="text-sm font-medium text-indigo-700 hover:underline shrink-0">
          Payment Planner →
        </Link>
      </div>
      {debt.label ? <p className="text-xs text-indigo-800">{debt.label}</p> : null}
      {debt.message && <p className="text-xs text-indigo-800">{debt.message}</p>}
      <p className="text-xs text-gray-600" title={INTEREST_TOOLTIP}>
        Est. {formatCurrency(debt.monthly_interest_burn)}/mo interest
      </p>
    </div>
  );
}
