import type { DashboardGoalSummary } from "@budget-app/shared";
import {
  dashboardGoalPercent,
  formatCurrency,
  formatGoalTargetDate,
  paceStatusLabel,
} from "@budget-app/shared";

/** Strip paycheck cadence and shorten wording for Dashboard summary cards. */
function stripPaycheckCadence(text: string): string {
  const monthlyOnly = text.split("·")[0]?.trim() ?? text;
  return monthlyOnly
    .replace(/\s+to reach your target date\.?$/i, " to reach target")
    .replace(/\s+to reach your target\.?$/i, " to reach target")
    .trim();
}

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
  const pace = goal.pace_status ?? goal.on_track_status;
  const monthly = goal.monthly_required ?? goal.recommended_monthly_contribution;
  const monthlyNum = monthly != null ? parseFloat(monthly) : NaN;
  const hasMonthly = Number.isFinite(monthlyNum) && monthlyNum > 0;
  const target = formatGoalTargetDate(goal.target_date);

  if (pace === "completed") {
    return null;
  }

  if (pace === "ahead") {
    return "Ahead of target pace";
  }

  if (pace === "on_track") {
    if (target) return `On pace for ${target}`;
    if (hasMonthly) return `Continue ${formatCurrency(monthly!)}/month to stay on pace`;
    return null;
  }

  if (pace === "behind" || pace === "stalled") {
    if (hasMonthly) return `Need ${formatCurrency(monthly!)}/month to reach target`;
    if (goal.contribution_recommendation) {
      return stripPaycheckCadence(goal.contribution_recommendation);
    }
    return null;
  }

  if (goal.contribution_recommendation) {
    return stripPaycheckCadence(goal.contribution_recommendation);
  }

  if (hasMonthly) {
    return `Need ${formatCurrency(monthly!)}/month to reach target`;
  }

  return null;
}

export function dashboardGoalProgressSummary(goal: DashboardGoalSummary): string {
  const pct = dashboardGoalPercent(goal.progress_percent);
  return `${formatCurrency(goal.current_amount)} of ${formatCurrency(goal.target_amount)} · ${pct}%`;
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
