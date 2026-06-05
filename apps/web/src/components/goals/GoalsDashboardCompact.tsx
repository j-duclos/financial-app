import type { FinancialGoal } from "@budget-app/shared";
import { goalsDashboardGridClass } from "../../lib/goalsDashboard";
import GoalDashboardCard from "./GoalDashboardCard";

type Props = {
  goals: FinancialGoal[];
  onGoalClick?: (goal: FinancialGoal) => void;
};

/** Top goals on dashboard with projections and funding context. */
export default function GoalsDashboardCompact({ goals }: Props) {
  if (goals.length === 0) return null;

  return (
    <div className={goalsDashboardGridClass(goals.length)}>
      {goals.map((goal) => (
        <GoalDashboardCard key={goal.id} goal={goal} />
      ))}
    </div>
  );
}
