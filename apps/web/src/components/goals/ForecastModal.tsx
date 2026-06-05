import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import type { FinancialGoal } from "@budget-app/shared";
import { getBucketForecast } from "@budget-app/api-client";
import {
  formatMonthlyAmount,
  formatProjectedCompletion,
  goalHealthBadgeClass,
  goalHealthLabel,
} from "../../lib/goalDisplay";
import {
  goalProjectionLine,
  goalSuggestionLine,
  paceStatusBadgeClass,
  paceStatusLabel,
} from "../../lib/goalInsights";

export default function ForecastModal({
  open,
  goal,
  onClose,
}: {
  open: boolean;
  goal: FinancialGoal;
  onClose: () => void;
}) {
  const { data, isLoading } = useQuery({
    queryKey: ["bucket-forecast", goal.id],
    queryFn: () => getBucketForecast(goal.id),
    enabled: open,
  });

  if (!open) return null;

  const merged = data ? { ...goal, ...data } : goal;
  const headline = goalProjectionLine(merged) || formatProjectedCompletion(data?.projected_completion_date);
  const suggestion = goalSuggestionLine(merged) ?? data?.recommendation;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto">
        <div className="p-6 space-y-4">
          <div className="flex justify-between items-center">
            <h2 className="text-lg font-semibold">Forecast — {goal.name}</h2>
            <button type="button" onClick={onClose} className="text-gray-500 hover:text-gray-800">
              Close
            </button>
          </div>

          {isLoading && <p className="text-sm text-gray-500">Loading forecast…</p>}

          {data && (
            <dl className="text-sm space-y-3">
              {headline && (
                <div className="rounded-md bg-gray-50 border border-gray-100 p-3">
                  <p className="text-gray-900 font-medium">{headline}</p>
                </div>
              )}

              {data.pace_status && (
                <div className="flex justify-between gap-4 items-center">
                  <dt className="text-gray-500">Pace</dt>
                  <dd>
                    <span
                      className={`text-xs font-medium px-2 py-0.5 rounded-full border ${paceStatusBadgeClass(data.pace_status)}`}
                    >
                      {paceStatusLabel(data.pace_status)}
                    </span>
                  </dd>
                </div>
              )}

              <div className="flex justify-between gap-4">
                <dt className="text-gray-500">Needed</dt>
                <dd className="font-medium">
                  {formatMonthlyAmount(data.monthly_required ?? data.suggested_monthly) ?? "—"}
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-gray-500">Current pace</dt>
                <dd className="font-medium">
                  {formatMonthlyAmount(data.current_contribution_rate) ?? "—"}
                </dd>
              </div>
              {data.suggested_biweekly && (
                <div className="flex justify-between gap-4">
                  <dt className="text-gray-500">Per paycheck</dt>
                  <dd className="font-medium">${data.suggested_biweekly}</dd>
                </div>
              )}
              <div className="flex justify-between gap-4">
                <dt className="text-gray-500">Gap</dt>
                <dd className="font-medium text-amber-800">
                  {data.forecast_gap && parseFloat(data.forecast_gap) > 0
                    ? formatMonthlyAmount(data.forecast_gap)
                    : "On pace"}
                </dd>
              </div>
              {data.automatic_transfer_label && (
                <div>
                  <dt className="text-gray-500 mb-0.5">Funding</dt>
                  <dd className="font-medium text-gray-800">{data.automatic_transfer_label}</dd>
                </div>
              )}
              {(data.forecast_status || data.goal_health) && (
                <div className="flex justify-between gap-4 items-center">
                  <dt className="text-gray-500">Schedule</dt>
                  <dd>
                    <span
                      className={`text-xs font-medium px-2 py-0.5 rounded-full ${goalHealthBadgeClass(data.goal_health)}`}
                    >
                      {goalHealthLabel(data.goal_health)}
                    </span>
                  </dd>
                </div>
              )}
              {data.pace_warnings && data.pace_warnings.length > 0 && (
                <ul className="text-xs text-amber-800 space-y-1">
                  {data.pace_warnings.map((w) => (
                    <li key={w}>• {w}</li>
                  ))}
                </ul>
              )}
              {suggestion && (
                <div className="rounded-md bg-blue-50 border border-blue-100 p-3 text-sm text-blue-900">
                  <p>{suggestion}</p>
                </div>
              )}
            </dl>
          )}

          <Link
            to={`/goals/${goal.id}`}
            onClick={onClose}
            className="block text-center text-sm text-blue-600 hover:underline"
          >
            Open full goal details →
          </Link>
        </div>
      </div>
    </div>
  );
}
