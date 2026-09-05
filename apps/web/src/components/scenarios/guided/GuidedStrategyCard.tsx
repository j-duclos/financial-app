import { getEffectiveDisplayName } from "@budget-app/shared";
import type { ScenarioGuidedStrategy } from "@budget-app/shared";
import {
  GUIDED_HYPOTHETICAL_DISCLAIMER,
  GUIDED_PLAN_CHANGE_TITLE,
} from "../../../lib/guidedStrategyDisplay";

type GuidedStrategyCardProps = {
  strategy: ScenarioGuidedStrategy | null | undefined;
  loading: boolean;
  errorMessage?: string | null;
  deletedNotice?: boolean;
  onCompare: () => void;
  onViewComparison: () => void;
  onEdit: () => void;
  onRemove: () => void;
};

export default function GuidedStrategyCard({
  strategy,
  loading,
  errorMessage,
  deletedNotice,
  onCompare,
  onViewComparison,
  onEdit,
  onRemove,
}: GuidedStrategyCardProps) {
  const configured = strategy != null;

  return (
    <section
      className="mb-6 rounded-xl border border-indigo-200 bg-indigo-50/70 px-4 py-4"
      aria-labelledby="guided-strategy-title"
    >
      <h2 id="guided-strategy-title" className="text-base font-semibold text-gray-900">
        Debt first vs. save first
      </h2>
      <p className="mt-1 text-sm text-gray-700">
        Compare keeping future savings transfers as planned with hypothetically redirecting those
        selected transfers toward selected credit cards. This does not move money in your real
        accounts.
      </p>
      <p className="mt-2 text-xs text-gray-600">{GUIDED_HYPOTHETICAL_DISCLAIMER}</p>

      {deletedNotice ? (
        <p className="mt-3 text-sm text-green-800" role="status">
          Strategy removed. This plan no longer includes a Debt first vs. save first comparison.
        </p>
      ) : null}

      {errorMessage ? (
        <p className="mt-3 text-sm text-red-700" role="alert">
          {errorMessage}
        </p>
      ) : null}

      {loading ? (
        <p className="mt-3 text-sm text-gray-600">Loading guided strategy…</p>
      ) : configured ? (
        <div className="mt-3 space-y-3">
          <p className="text-sm text-gray-800">
            <span className="font-medium">{GUIDED_PLAN_CHANGE_TITLE}.</span>{" "}
            {parseFloat(strategy.allocation_percent)}% of selected transfer amounts is tested
            against the selected cards.
          </p>
          <p className="text-xs text-gray-600">
            Source: {getEffectiveDisplayName(strategy.source_account)} · Savings:{" "}
            {getEffectiveDisplayName(strategy.savings_account)}
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={onViewComparison}
              className="px-3 py-1.5 bg-indigo-700 text-white text-sm font-medium rounded hover:bg-indigo-800"
            >
              View comparison
            </button>
            <button
              type="button"
              onClick={onEdit}
              className="px-3 py-1.5 bg-white border border-gray-300 rounded text-sm hover:bg-gray-50"
            >
              Edit strategy
            </button>
            <button
              type="button"
              onClick={onRemove}
              className="px-3 py-1.5 bg-white border border-red-200 text-red-700 rounded text-sm hover:bg-red-50"
            >
              Remove strategy
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-3">
          <button
            type="button"
            onClick={onCompare}
            className="px-3 py-1.5 bg-indigo-700 text-white text-sm font-medium rounded hover:bg-indigo-800"
          >
            Compare strategies
          </button>
        </div>
      )}
    </section>
  );
}
