import { formatCurrency } from "@budget-app/shared";
import type { GoalsAggregateSummary } from "@budget-app/shared";
import DashboardMetricTile from "../dashboard/DashboardMetricTile";
import { METRIC_TILE_GRID_4 } from "../dashboard/metricTileLayout";
import { formatProjectedCompletion } from "../../lib/goalDisplay";

export default function GoalsSummaryBar({ summary }: { summary: GoalsAggregateSummary }) {
  const completion = formatProjectedCompletion(summary.projected_completion);
  const onTrackLabel =
    summary.goals_active_count > 0
      ? `${summary.goals_on_track} of ${summary.goals_active_count}`
      : "—";

  return (
    <div className={METRIC_TILE_GRID_4}>
      <DashboardMetricTile
        label="Goal progress"
        value={`${formatCurrency(summary.total_saved)}/${formatCurrency(summary.total_target)}`}
      />
      <DashboardMetricTile
        label="Monthly needed"
        value={
          parseFloat(summary.monthly_needed_total) > 0
            ? `${formatCurrency(summary.monthly_needed_total)}/mo`
            : "—"
        }
      />
      <DashboardMetricTile label="On track" value={onTrackLabel} />
      <DashboardMetricTile label="Completion" value={completion ?? "—"} />
    </div>
  );
}
