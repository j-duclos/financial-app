import { Link } from "react-router-dom";
import { formatCurrency } from "@budget-app/shared";
import type { FinancialGoal } from "@budget-app/shared";
import {
  GOAL_TYPE_ICONS,
  GOAL_TYPE_LABELS,
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
import GoalActionMenu from "./GoalActionMenu";

type Props = {
  goal: FinancialGoal;
  onForecast: () => void;
  onEdit?: () => void;
  onDuplicate?: () => void;
  onPause?: () => void;
  onComplete?: () => void;
  onArchive?: () => void;
  onDelete?: () => void;
  variant?: "page" | "dashboard";
};

export default function GoalCard({
  goal,
  onForecast,
  onEdit,
  onDuplicate,
  onPause,
  onComplete,
  onArchive,
  onDelete,
  variant = "page",
}: Props) {
  const showMenu = variant === "page" && onEdit && onDelete;
  const pct = parseProgressPercent(goal.progress_percent);
  const projection = goalProjectionLine(goal);
  const suggestion = goalSuggestionLine(goal);
  const { source, transfer } = goalFundingLine(goal);
  const paceLabel = paceStatusLabel(goal.pace_status);

  return (
    <article className="bg-white rounded-lg border border-gray-200 p-4 space-y-3">
      <div className="flex justify-between gap-2 items-start">
        <div className="min-w-0 flex-1">
          <Link to={`/goals/${goal.id}`} className="group">
            <h3 className="font-semibold text-gray-900 truncate group-hover:text-blue-700">
              <span className="mr-1.5" aria-hidden>
                {GOAL_TYPE_ICONS[goal.goal_type]}
              </span>
              {goal.name}
            </h3>
          </Link>
          <p className="text-xs text-gray-500">{GOAL_TYPE_LABELS[goal.goal_type]}</p>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {paceLabel ? (
            <span
              className={`text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full border ${paceStatusBadgeClass(goal.pace_status)}`}
            >
              {paceLabel}
            </span>
          ) : null}
          {showMenu ? (
            <GoalActionMenu
              goal={goal}
              onEdit={onEdit!}
              onForecast={onForecast}
              onDuplicate={onDuplicate!}
              onPause={onPause!}
              onComplete={onComplete!}
              onArchive={onArchive!}
              onDelete={onDelete!}
            />
          ) : null}
        </div>
      </div>

      <div className="h-2 rounded-full bg-gray-100 overflow-hidden">
        <div
          className="h-full rounded-full bg-blue-600"
          style={{ width: `${pct}%` }}
        />
      </div>

      <p className="text-sm font-medium text-gray-800">{formatGoalProgressLine(goal)}</p>

      {projection ? (
        <p className="text-sm text-gray-700">{projection}</p>
      ) : null}

      {suggestion ? (
        <p className="text-xs text-blue-800">{suggestion}</p>
      ) : null}

      {source ? <p className="text-xs text-gray-500">{source}</p> : null}

      {transfer ? (
        <p className="text-xs text-gray-500 truncate" title={transfer}>
          {transfer}
        </p>
      ) : null}

      {goal.milestones && goal.milestones.length > 0 && (
        <ul className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-gray-600">
          {goal.milestones.map((m) => (
            <li key={m.percent}>
              <span aria-hidden>{m.achieved ? "✔" : "○"}</span> {m.label}
            </li>
          ))}
        </ul>
      )}

      {goal.status === "active" && (
        <div className="flex flex-wrap gap-2 pt-1 border-t border-gray-100">
          <Link
            to={`/goals/${goal.id}`}
            className="px-3 py-1.5 text-sm font-medium text-gray-700 border border-gray-300 rounded-md hover:bg-gray-50"
          >
            Details
          </Link>
          <button
            type="button"
            onClick={onForecast}
            className="px-3 py-1.5 text-sm font-medium text-gray-600 hover:text-gray-900"
          >
            Quick forecast
          </button>
        </div>
      )}
    </article>
  );
}
