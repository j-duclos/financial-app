import { useEffect } from "react";
import { Link } from "react-router-dom";
import type {
  Account,
  DebtPayoffCardSummary,
  DebtPayoffPlan,
  PayoffProjection,
  PayoffStrategy,
} from "@budget-app/shared";
import { formatCurrency, getEffectiveDisplayName } from "@budget-app/shared";
import { drawerForecastRows, drawerPayoffImpossibleMessage } from "../../lib/debtCardDisplay";
import {
  DRAWER_PAYOFF_STRATEGY_OPTIONS,
  drawerPaymentAmountDisplay,
  drawerStrategyRequiresAmountInput,
} from "../../lib/paymentPlannerDisplay";

type Props = {
  variant: "panel" | "sheet";
  account: Account;
  planCard: DebtPayoffCardSummary;
  globalPlan: DebtPayoffPlan | null | undefined;
  cardStrategy: PayoffStrategy;
  amountInput: string;
  onStrategyChange: (strategy: PayoffStrategy) => void;
  onAmountChange: (value: string) => void;
  projection: PayoffProjection | null | undefined;
  projectionLoading: boolean;
  projectionError: string | null;
  onClose: () => void;
};

function ForecastRow({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: "positive" | "warning";
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-xs">
      <dt className="text-gray-500 shrink-0">{label}</dt>
      <dd
        className={`font-semibold text-right tabular-nums ${
          accent === "positive"
            ? "text-emerald-800"
            : accent === "warning"
              ? "text-amber-800"
              : "text-gray-900"
        }`}
      >
        {value}
      </dd>
    </div>
  );
}

export default function DebtStrategyDrawer({
  variant,
  account,
  planCard,
  globalPlan,
  cardStrategy,
  amountInput,
  onStrategyChange,
  onAmountChange,
  projection,
  projectionLoading,
  projectionError,
  onClose,
}: Props) {
  const paymentDisplay = drawerPaymentAmountDisplay(account, planCard, cardStrategy, amountInput);
  const forecastRows = drawerForecastRows(projection, planCard, globalPlan, paymentDisplay);
  const name = getEffectiveDisplayName(account);

  useEffect(() => {
    if (cardStrategy !== "custom_amount") return;
    if (amountInput.trim()) return;
    const preset = planCard.suggested_payment || planCard.minimum_payment;
    if (preset) onAmountChange(preset);
  }, [cardStrategy, amountInput, planCard, onAmountChange]);

  const body = (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-3 border-b border-gray-100 pb-2">
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-indigo-600">
            Debt strategy
          </p>
          <h2 className="text-base font-bold text-gray-900 truncate">{name}</h2>
          <p className="text-xl font-bold text-gray-900 tabular-nums mt-0.5">
            {formatCurrency(planCard.balance)}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0 pt-0.5">
          <Link
            to="/transactions"
            state={{ accountId: account.id }}
            className="text-xs text-blue-600 hover:underline"
          >
            Ledger
          </Link>
          <button
            type="button"
            onClick={onClose}
            className="text-xs text-gray-500 hover:text-gray-800"
          >
            Close
          </button>
        </div>
      </div>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
        <div>
          <dt className="text-gray-500">APR</dt>
          <dd className="font-medium text-gray-900">{planCard.apr}%</dd>
        </div>
        <div>
          <dt className="text-gray-500">Utilization</dt>
          <dd className="font-medium text-gray-900">
            {planCard.utilization_percent ? `${planCard.utilization_percent}%` : "—"}
          </dd>
        </div>
        <div>
          <dt className="text-gray-500">Minimum</dt>
          <dd className="font-medium text-gray-900 tabular-nums">
            {formatCurrency(planCard.minimum_payment)}
          </dd>
        </div>
        <div>
          <dt className="text-gray-500">Plan suggests</dt>
          <dd className="font-medium text-indigo-700 tabular-nums">
            {formatCurrency(planCard.suggested_payment)}/mo
          </dd>
        </div>
      </dl>

      <div className="space-y-2">
        <p className="text-xs font-semibold text-gray-900">Payment scenario</p>
        <div className="flex flex-wrap gap-1.5">
          {DRAWER_PAYOFF_STRATEGY_OPTIONS.map((opt) => (
            <button
              key={opt.id}
              type="button"
              title={opt.description}
              onClick={() => onStrategyChange(opt.id)}
              className={`px-2.5 py-1 text-xs rounded-full border ${
                cardStrategy === opt.id
                  ? "bg-indigo-600 text-white border-indigo-600"
                  : "border-gray-300 hover:bg-gray-50"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
        <label className="block text-xs">
          <span className="text-gray-600">Monthly payment</span>
          <input
            type="number"
            min="0"
            step="0.01"
            value={paymentDisplay}
            readOnly={!drawerStrategyRequiresAmountInput(cardStrategy)}
            onChange={(e) => onAmountChange(e.target.value)}
            className="mt-1 w-full rounded border border-gray-300 px-2 py-1.5 text-sm tabular-nums read-only:bg-gray-50 read-only:text-gray-800"
          />
        </label>
      </div>

      <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 space-y-2">
        <p className="text-xs font-semibold text-gray-900">Forecast</p>
        {projectionLoading && (
          <p className="text-xs text-gray-500 animate-pulse">Updating projection…</p>
        )}
        {projectionError && <p className="text-xs text-red-600">{projectionError}</p>}
        {!projectionLoading && projection && !projection.payoff_possible && (
          <p className="text-xs text-amber-900 bg-amber-50 border border-amber-100 rounded px-2 py-1.5 leading-snug">
            {drawerPayoffImpossibleMessage(planCard, projection)}
          </p>
        )}
        {!projectionLoading && forecastRows.length > 0 && (
          <dl className="space-y-1.5">
            {forecastRows.map((row) => (
              <ForecastRow key={row.label} {...row} />
            ))}
          </dl>
        )}
      </div>
    </div>
  );

  if (variant === "panel") {
    return (
      <aside
        className="rounded-lg border border-gray-200 bg-white shadow-sm p-3 max-h-[calc(100vh-6rem)] overflow-y-auto"
        aria-label={`Debt strategy for ${name}`}
      >
        {body}
      </aside>
    );
  }

  return (
    <>
      <button
        type="button"
        className="fixed inset-0 z-40 bg-black/40"
        aria-label="Close debt strategy panel"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Debt strategy for ${name}`}
        className="fixed inset-x-0 bottom-0 z-50 max-h-[85vh] overflow-y-auto rounded-t-xl border border-gray-200 bg-white shadow-2xl p-4"
      >
        {body}
      </div>
    </>
  );
}
