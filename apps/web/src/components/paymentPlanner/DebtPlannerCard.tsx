import type { DebtPayoffCardSummary } from "@budget-app/shared";
import { formatCurrency } from "@budget-app/shared";
import { debtCardOutcomeLines } from "../../lib/debtCardDisplay";

type Props = {
  card: DebtPayoffCardSummary;
  selected: boolean;
  onSelect: () => void;
};

export default function DebtPlannerCard({ card, selected, onSelect }: Props) {
  const outcomes = debtCardOutcomeLines(card);

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={`text-left rounded-lg border p-2.5 transition ${
        selected
          ? "border-indigo-500 bg-indigo-50/40 shadow-md ring-2 ring-indigo-200"
          : "border-gray-200 bg-white hover:border-indigo-200 hover:shadow-sm"
      }`}
    >
      <div className="flex justify-between gap-2 items-start">
        <h3 className="text-sm font-semibold text-gray-900">{card.name}</h3>
        {card.payoff_order != null && (
          <span
            className={`text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded ${
              selected ? "bg-indigo-100 text-indigo-800" : "bg-gray-100 text-gray-600"
            }`}
          >
            #{card.payoff_order}
          </span>
        )}
      </div>
      <p className="text-lg font-bold text-gray-900 mt-0.5 tabular-nums">
        {formatCurrency(card.balance)}
      </p>
      <p className="text-xs font-semibold text-indigo-900 mt-1">{outcomes.headline}</p>
      <p className="text-[11px] text-indigo-700 mt-0.5">{outcomes.suggestedLine}</p>
      {outcomes.interestLine && (
        <p className="text-[11px] text-gray-600 mt-0.5">{outcomes.interestLine}</p>
      )}
      <dl className="mt-1.5 grid grid-cols-2 gap-x-2 gap-y-0.5 text-[10px] border-t border-gray-100 pt-1.5">
        <div>
          <dt className="text-gray-500">APR</dt>
          <dd className="font-medium text-gray-800">{card.apr}%</dd>
        </div>
        <div>
          <dt className="text-gray-500">Utilization</dt>
          <dd className="font-medium text-gray-800">
            {card.utilization_percent ? `${card.utilization_percent}%` : "—"}
          </dd>
        </div>
        <div>
          <dt className="text-gray-500">Minimum</dt>
          <dd className="font-medium text-gray-800 tabular-nums">
            {formatCurrency(card.minimum_payment)}
          </dd>
        </div>
        <div>
          <dt className="text-gray-500">Interest / mo</dt>
          <dd className="font-medium text-gray-800 tabular-nums">
            {formatCurrency(card.interest_this_month)}
          </dd>
        </div>
      </dl>
      {card.autopay_enabled && (
        <p className="text-[10px] text-indigo-600 mt-1">Autopay on</p>
      )}
    </button>
  );
}
