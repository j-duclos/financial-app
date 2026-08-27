import type { DashboardGoalSummary } from "@budget-app/shared";
import {
  formatGoalProgressSummary,
  formatGoalTargetDate,
  goalPrimaryRecommendation,
  paceStatusLabel,
} from "@budget-app/shared";

/** Single concise recommendation for Dashboard — monthly cadence only. */
export function dashboardGoalSummaryRecommendation(
  goal: Pick<
    DashboardGoalSummary,
    | "contribution_recommendation"
    | "monthly_required"
    | "recommended_monthly_contribution"
    | "pace_status"
    | "on_track_status"
    | "target_date"
  >
): string | null {
  return goalPrimaryRecommendation(goal);
}

export function dashboardGoalProgressSummary(goal: DashboardGoalSummary): string {
  return formatGoalProgressSummary(goal);
}

export function dashboardGoalAccessibilityLabel(goal: DashboardGoalSummary): string {
  const status = paceStatusLabel(goal.pace_status ?? goal.on_track_status) || "Unknown status";
  const progress = dashboardGoalProgressSummary(goal);
  const target = formatGoalTargetDate(goal.target_date);
  const recommendation = dashboardGoalSummaryRecommendation(goal);
  return [
    goal.name,
    status,
    progress.replace(" · ", ", "),
    target ? `Target ${target}` : null,
    recommendation,
  ]
    .filter(Boolean)
    .join(". ")
    .replace(/%/g, " percent") + ".";
}
