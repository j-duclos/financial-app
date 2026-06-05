import { Link } from "react-router-dom";
import type { FinancialGoal, GoalsAggregateSummary, GoalWarning } from "@budget-app/shared";
import GoalsDashboardCompact from "../goals/GoalsDashboardCompact";
import { topActiveGoalsForDashboard } from "../../lib/goalsDashboard";

export default function GoalsProgressSection({
  goals,
  goalsLoading = false,
  goalsSummary,
  warnings = [],
}: {
  goals: FinancialGoal[];
  goalsLoading?: boolean;
  goalsSummary?: GoalsAggregateSummary | null;
  warnings?: GoalWarning[];
  /** @deprecated Forecast opens from Goals page; kept for Dashboard API compatibility */
  onForecast?: (goal: FinancialGoal) => void;
}) {
  if (goalsLoading) {
    return (
      <div className="bg-white rounded-lg border border-gray-200 p-3 text-sm text-gray-500">
        Loading goals…
      </div>
    );
  }

  const activeGoals = topActiveGoalsForDashboard(goals, 3);
  const otherGoals = goals.filter((g) => g.status === "completed" || g.status === "archived");

  if (goals.length === 0) {
    return (
      <div className="bg-white rounded-lg shadow p-4 text-center space-y-3">
        <p className="text-sm text-gray-600">Create your first goal</p>
        <ul className="text-xs text-gray-500 space-y-1">
          <li>Build emergency fund</li>
          <li>Save for house down payment</li>
          <li>Pay off credit cards</li>
        </ul>
        <div className="flex flex-wrap justify-center gap-3 pt-1">
          <Link
            to="/goals?new=1"
            className="text-sm font-medium text-blue-600 hover:underline"
          >
            Add goal
          </Link>
          <Link to="/goals" className="text-sm text-gray-600 hover:underline">
            View all goals
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {warnings.length > 0 && (
        <ul className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-2.5 space-y-0.5">
          {warnings.map((w) => (
            <li key={w.bucket_id}>{w.message}</li>
          ))}
        </ul>
      )}

      {activeGoals.length > 0 ? (
        <GoalsDashboardCompact goals={activeGoals} />
      ) : (
        <div className="bg-white rounded-lg border border-gray-200 p-3 text-sm text-gray-600">
          No active goals.{" "}
          <Link to="/goals" className="text-blue-600 hover:underline">
            View goals
          </Link>
        </div>
      )}

      {otherGoals.length > 0 && (
        <p className="text-xs text-gray-500 text-right">
          {otherGoals.length} completed or archived —{" "}
          <Link to="/goals" className="text-blue-600 hover:underline">
            View all
          </Link>
        </p>
      )}
    </div>
  );
}
