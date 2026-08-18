import { Link } from "react-router-dom";
import type { FinancialGoal } from "@budget-app/shared";
import { GOAL_TYPE_ICONS, parseProgressPercent } from "../../lib/goalDisplay";
import {
  goalCardGapValue,
  goalCardMetrics,
  goalFundedProgressLine,
  goalSuggestionLine,
  paceStatusBadgeClass,
  paceStatusLabel,
} from "../../lib/goalInsights";
import GoalActionMenu from "./GoalActionMenu";
import { whatIfGoalPath } from "../../lib/whatIfContext";

type Props = {
  goal: FinancialGoal;
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
  const suggestion = goalSuggestionLine(goal);
  const metrics = goalCardMetrics(goal);
  const gap = goalCardGapValue(goal);
  const paceLabel = paceStatusLabel(goal.pace_status);

  return (
    <article className="bg-white rounded-lg border border-gray-200 p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <Link to={`/goals/${goal.id}`} className="group min-w-0 flex-1">
          <h3 className="font-semibold text-gray-900 truncate group-hover:text-blue-700">
            <span className="mr-1.5" aria-hidden>
              {GOAL_TYPE_ICONS[goal.goal_type]}
            </span>
            {goal.name}
          </h3>
        </Link>
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
        <div className="h-full rounded-full bg-blue-600" style={{ width: `${pct}%` }} />
      </div>

      <p className="text-sm font-medium text-gray-800">{goalFundedProgressLine(goal)}</p>

      {metrics.length > 0 ? (
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-sm">
          {metrics.map((row) => (
            <div key={row.label} className="flex flex-col sm:block">
              <dt className="text-xs text-gray-500">{row.label}</dt>
              <dd className="font-medium text-gray-900">{row.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}

      {(gap || suggestion) && (
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-sm">
          {gap ? <p className="font-medium text-amber-800">Gap: {gap}</p> : <span />}
          {suggestion ? (
            <p className="text-blue-800 sm:text-right">
              <span className="font-medium text-gray-700">Recommendation: </span>
              {suggestion}
            </p>
          ) : null}
        </div>
      )}

      {goal.milestones && goal.milestones.length > 0 && (
        <ul className="flex flex-wrap justify-center gap-x-4 gap-y-1 text-xs text-gray-600">
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
          <Link
            to={whatIfGoalPath(goal.id)}
            className="px-3 py-1.5 text-sm font-medium text-blue-700 hover:underline"
          >
            Try in What-If
          </Link>
        </div>
      )}
    </article>
  );
}
