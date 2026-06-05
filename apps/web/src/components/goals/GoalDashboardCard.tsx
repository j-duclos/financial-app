import { Link } from "react-router-dom";
import type { FinancialGoal } from "@budget-app/shared";
import {
  formatGoalProgressLine,
  parseProgressPercent,
} from "../../lib/goalDisplay";
import {
  goalFundingLine,
  goalProjectionLine,
  goalSuggestionLine,
  paceStatusBadgeClass,
  paceStatusLabel,
} from "../../lib/goalInsights";

type Props = {
  goal: FinancialGoal;
};

/** Rich goal row for dashboard — projection, suggestion, funding. */
export default function GoalDashboardCard({ goal }: Props) {
  const pct = parseProgressPercent(goal.progress_percent);
  const projection = goalProjectionLine(goal);
  const suggestion = goalSuggestionLine(goal);
  const { source, transfer } = goalFundingLine(goal);
  const pace = goal.pace_status;
  const paceLabel = paceStatusLabel(pace);

  return (
    <Link
      to={`/goals/${goal.id}`}
      className="block h-full min-w-0 rounded-lg border border-gray-200 bg-white p-3 hover:border-blue-300 hover:shadow-sm transition-shadow"
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <h3 className="font-semibold text-gray-900 truncate text-sm">{goal.name}</h3>
        {paceLabel ? (
          <span
            className={`shrink-0 text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full border ${paceStatusBadgeClass(pace)}`}
          >
            {paceLabel}
          </span>
        ) : null}
      </div>

      <div className="h-2 rounded-full bg-gray-100 overflow-hidden mb-2">
        <div
          className="h-full rounded-full bg-blue-600 transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>

      <p className="text-xs font-medium text-gray-800">{formatGoalProgressLine(goal)}</p>

      {projection ? (
        <p className="text-xs text-gray-600 mt-1">{projection}</p>
      ) : null}

      {suggestion ? (
        <p className="text-xs text-blue-800 mt-0.5">{suggestion}</p>
      ) : null}

      {source ? <p className="text-xs text-gray-500 mt-1">{source}</p> : null}

      {transfer ? (
        <p className="text-xs text-gray-500 truncate" title={transfer}>
          {transfer.startsWith("Automatic") ? transfer : `Automatic transfer: ${transfer}`}
        </p>
      ) : null}
    </Link>
  );
}
