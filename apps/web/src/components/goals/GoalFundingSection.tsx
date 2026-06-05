import type { RecurringRule } from "@budget-app/shared";
import {
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

  function patch(partial: Partial<GoalFundingFormState>) {
    onChange({ ...funding, ...partial });
  }

  return (
    <fieldset className="space-y-3 text-sm border border-indigo-100 rounded-md p-3 bg-indigo-50/40">
      <legend className="text-indigo-900 font-medium px-1">Paycheck auto-funding</legend>
      <p className="text-xs text-indigo-900/80 leading-snug">
        When enabled, each paycheck allocates money to this goal and schedules a transfer into
        the linked account (when paycheck and goal accounts differ).
      </p>

      <label className="flex items-start gap-2">
        <input
          type="checkbox"
          className="mt-0.5"
          checked={funding.enabled}
          onChange={(e) => patch({ enabled: e.target.checked })}
        />
        <span>
          <span className="font-medium text-gray-900">Auto-transfer on payday</span>
          <span className="block text-xs text-gray-600 mt-0.5">
            Creates a recurring transfer matched to your paycheck schedule.
          </span>
        </span>
      </label>

      {funding.enabled && (
        <div className="space-y-3 pl-1 border-l-2 border-indigo-200 ml-1">
          {!linkedAccountId && (
            <p className="text-xs text-amber-800 bg-amber-50 border border-amber-100 rounded px-2 py-1.5">
              Link a savings or checking account above before setting up auto-funding.
            </p>
          )}

          <label className="block">
            <span className="text-gray-700">Paycheck / income rule</span>
            <select
              value={funding.incomeRuleId}
              onChange={(e) =>
                patch({ incomeRuleId: e.target.value ? Number(e.target.value) : "" })
              }
              disabled={!linkedAccountId || rulesLoading}
              className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm disabled:bg-gray-100"
            >
              <option value="">Select income rule</option>
              {paycheckRules.map((rule) => (
                <option key={rule.id} value={rule.id}>
                  {formatIncomeRuleOption(rule)}
                </option>
              ))}
            </select>
            {rulesLoading && (
              <p className="mt-1 text-xs text-gray-500">Loading income rules…</p>
            )}
            {!rulesLoading && paycheckRules.length === 0 && (
              <p className="mt-1 text-xs text-gray-600">
                No income rules yet. Add a paycheck under Automation → Rules first.
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
                    ? "bg-indigo-600 text-white border-indigo-600"
                    : "border-gray-300 hover:bg-white"
                }`}
              >
                Fixed $
              </button>
              <button
                type="button"
                onClick={() => patch({ amountMode: "percent" })}
                className={`px-2.5 py-1 text-xs rounded-full border ${
                  funding.amountMode === "percent"
                    ? "bg-indigo-600 text-white border-indigo-600"
                    : "border-gray-300 hover:bg-white"
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
        </div>
      )}
    </fieldset>
  );
}
