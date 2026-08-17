import type { RecurringRule } from "@budget-app/shared";
import {
  estimatePaycheckContributionLabel,
  formatIncomeRuleOption,
  incomeRulesForFunding,
  type GoalFundingFormState,
} from "../../lib/goalFundingForm";

type Props = {
  funding: GoalFundingFormState;
  incomeRules: RecurringRule[];
  linkedAccountId: number | "";
  monthlyTarget: string;
  rulesLoading?: boolean;
  onChange: (next: GoalFundingFormState) => void;
};

export default function GoalFundingSection({
  funding,
  incomeRules,
  linkedAccountId,
  monthlyTarget,
  rulesLoading,
  onChange,
}: Props) {
  const paycheckRules = incomeRulesForFunding(incomeRules);
  const estimate = estimatePaycheckContributionLabel(funding, monthlyTarget, paycheckRules);

  function patch(partial: Partial<GoalFundingFormState>) {
    onChange({ ...funding, ...partial });
  }

  return (
    <div className="space-y-3 text-sm">
      <div>
        <p className="text-gray-800 font-medium">Paycheck auto-funding</p>
        <p className="text-xs text-gray-500 mt-0.5">
          Automatically contribute to this goal each payday.
        </p>
      </div>

      <label className="flex items-start gap-2">
        <input
          type="checkbox"
          className="mt-0.5"
          checked={funding.enabled}
          onChange={(e) => patch({ enabled: e.target.checked })}
        />
        <span>
          <span className="font-medium text-gray-900">Auto-transfer on payday</span>
          <span className="block text-xs text-gray-500 mt-0.5">
            Actually schedules a transfer on your paycheck schedule. This is separate from the
            planned monthly contribution above.
          </span>
        </span>
      </label>

      {funding.enabled && (
        <div className="space-y-3 pl-6">
          {!linkedAccountId && (
            <p className="text-xs text-amber-800">
              Link an account above before setting up auto-funding.
            </p>
          )}

          <label className="block">
            <span className="text-gray-700">Paycheck</span>
            <select
              value={funding.incomeRuleId}
              onChange={(e) =>
                patch({ incomeRuleId: e.target.value ? Number(e.target.value) : "" })
              }
              disabled={!linkedAccountId || rulesLoading}
              className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm disabled:bg-gray-100"
            >
              <option value="">Select paycheck</option>
              {paycheckRules.map((rule) => (
                <option key={rule.id} value={rule.id}>
                  {formatIncomeRuleOption(rule)}
                </option>
              ))}
            </select>
            {rulesLoading && (
              <p className="mt-1 text-xs text-gray-500">Loading paychecks…</p>
            )}
            {!rulesLoading && paycheckRules.length === 0 && (
              <p className="mt-1 text-xs text-gray-600">
                No paychecks yet. Add one under Automation → Rules first.
              </p>
            )}
          </label>

          <div>
            <span className="text-gray-700 block mb-1.5">Amount per paycheck</span>
            <div className="flex flex-wrap gap-2 mb-2">
              <button
                type="button"
                onClick={() => patch({ amountMode: "fixed" })}
                className={`px-2.5 py-1 text-xs rounded-full border ${
                  funding.amountMode === "fixed"
                    ? "bg-gray-900 text-white border-gray-900"
                    : "border-gray-300 hover:bg-gray-50"
                }`}
              >
                Fixed $
              </button>
              <button
                type="button"
                onClick={() => patch({ amountMode: "percent" })}
                className={`px-2.5 py-1 text-xs rounded-full border ${
                  funding.amountMode === "percent"
                    ? "bg-gray-900 text-white border-gray-900"
                    : "border-gray-300 hover:bg-gray-50"
                }`}
              >
                % of paycheck
              </button>
            </div>
            {funding.amountMode === "fixed" ? (
              <input
                type="number"
                min="0.01"
                step="0.01"
                placeholder={monthlyTarget.trim() ? `Default: ${monthlyTarget}` : "e.g. 400"}
                value={funding.fixedAmount}
                onChange={(e) => patch({ fixedAmount: e.target.value })}
                className="w-full rounded border border-gray-300 px-3 py-2 text-sm tabular-nums"
              />
            ) : (
              <input
                type="number"
                min="0.01"
                max="100"
                step="0.01"
                placeholder="e.g. 10"
                value={funding.percent}
                onChange={(e) => patch({ percent: e.target.value })}
                className="w-full rounded border border-gray-300 px-3 py-2 text-sm tabular-nums"
              />
            )}
          </div>

          {estimate ? (
            <p className="text-xs text-gray-700">
              Estimated contribution: <span className="font-medium">{estimate}</span>
            </p>
          ) : null}
        </div>
      )}
    </div>
  );
}
