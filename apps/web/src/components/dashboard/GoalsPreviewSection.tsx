import { Link } from "react-router-dom";
import type { DashboardGoalSummary, FinancialGoal } from "@budget-app/shared";
import { formatCurrency } from "@budget-app/shared";
import {
  formatGoalProgressLine,
  formatProjectedCompletion,
  onTrackBadgeClass,
  onTrackLabel,
  parseProgressPercent,
} from "../../lib/goalDisplay";
import { paceStatusBadgeClass, paceStatusLabel } from "../../lib/goalInsights";
import { primaryGoalForDashboard } from "../../lib/goalsDashboard";

export const GOALS_PREVIEW_SECTION_TITLE = "Goals Progress";

type GoalLike = DashboardGoalSummary | FinancialGoal;

type Props = {
  goals: GoalLike[];
  loading?: boolean;
};

function goalTrackBadge(goal: GoalLike): { label: string; className: string } | null {
  const pace = paceStatusLabel(goal.pace_status);
  if (pace) {
    return { label: pace, className: paceStatusBadgeClass(goal.pace_status) };
  }
  const track = onTrackLabel(goal.on_track_status);
  if (!track) return null;
  return { label: track, className: onTrackBadgeClass(goal.on_track_status) };
}

function goalSavedAmount(goal: GoalLike): string {
  if (goal.is_debt_goal) {
    return formatCurrency(goal.linked_debt_balance ?? goal.remaining_amount);
  }
  return formatCurrency(goal.current_amount);
}

function goalTargetAmount(goal: GoalLike): string {
  if (goal.is_debt_goal) {
    return formatCurrency(goal.target_amount);
  }
  return formatCurrency(goal.target_amount);
}

/** Single highest-priority goal preview for the action-focused dashboard. */
export default function GoalsPreviewSection({ goals, loading = false }: Props) {
  if (loading) {
    return (
      <div className="rounded-lg border border-gray-200 bg-white p-3 text-sm text-gray-500">
        Loading goals…
      </div>
    );
  }

  const primary = primaryGoalForDashboard(goals);

  if (!primary) {
    return (
      <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 p-4 text-center space-y-2">
        <p className="text-sm text-gray-600">Set a savings or payoff goal to track progress here.</p>
        <Link to="/goals?new=1" className="text-sm font-medium text-blue-600 hover:underline">
          Create a goal
        </Link>
      </div>
    );
  }

  const pct = parseProgressPercent(primary.progress_percent);
  const badge = goalTrackBadge(primary);
  const completion = formatProjectedCompletion(primary.projected_completion_date);

  return (
    <Link
      to={`/goals/${primary.id}`}
      className="block rounded-lg border border-gray-200 bg-white p-3 hover:border-blue-300 hover:shadow-sm transition-shadow"
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">
            Primary goal
          </p>
          <h3 className="font-semibold text-gray-900 truncate text-sm">{primary.name}</h3>
        </div>
        {badge ? (
          <span
            className={`shrink-0 text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full border ${badge.className}`}
          >
            {badge.label}
          </span>
        ) : null}
      </div>

      <div className="h-2 rounded-full bg-gray-100 overflow-hidden mb-2">
        <div
          className="h-full rounded-full bg-blue-600 transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>

      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-xs">
        <p className="text-gray-800">
          <span className="text-gray-500">Saved </span>
          <span className="font-medium">{goalSavedAmount(primary)}</span>
          <span className="text-gray-500"> of </span>
          <span className="font-medium">{goalTargetAmount(primary)}</span>
        </p>
        {completion ? (
          <p className="text-gray-500">
            Est. completion <span className="text-gray-700 font-medium">{completion}</span>
          </p>
        ) : null}
      </div>

      <p className="mt-1.5 text-xs text-gray-500">{formatGoalProgressLine(primary)}</p>
    </Link>
  );
}

export function GoalsPreviewSectionHeader() {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 mb-1.5">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
        {GOALS_PREVIEW_SECTION_TITLE}
      </h2>
      <Link to="/goals" className="text-xs text-blue-600 hover:underline shrink-0">
        View Goals
      </Link>
    </div>
  );
}
