import type { FinancialGoal, GoalPaceStatus } from "@budget-app/shared";
import { formatCurrency } from "@budget-app/shared";

/** Tailwind classes for pace status (dashboard + cards). */
export function paceStatusColorClass(pace: GoalPaceStatus | string | undefined): string {
  switch (pace) {
    case "ahead":
    case "on_track":
    case "completed":
      return "text-emerald-700";
    case "behind":
      return "text-amber-700";
    case "stalled":
      return "text-red-700";
    default:
      return "text-gray-600";
  }
}

export function paceStatusBadgeClass(pace: GoalPaceStatus | string | undefined): string {
  switch (pace) {
    case "ahead":
    case "on_track":
    case "completed":
      return "bg-emerald-50 text-emerald-800 border-emerald-200";
    case "behind":
      return "bg-amber-50 text-amber-900 border-amber-200";
    case "stalled":
      return "bg-red-50 text-red-800 border-red-200";
    default:
      return "bg-gray-50 text-gray-700 border-gray-200";
  }
}

export function paceStatusLabel(pace: GoalPaceStatus | string | undefined): string {
  switch (pace) {
    case "ahead":
      return "Ahead";
    case "on_track":
      return "On track";
    case "behind":
      return "Behind";
    case "stalled":
      return "Stalled";
    case "completed":
      return "Completed";
    default:
      return "";
  }
}

/** Primary projection line for cards (API headline or fallback). */
export function goalProjectionLine(goal: Pick<FinancialGoal, "projection_headline" | "pace_status" | "projected_completion_date" | "target_date" | "on_track_status">): string {
  if (goal.projection_headline) return goal.projection_headline;
  if (goal.pace_status === "stalled") return "No funding activity yet";
  return "";
}

/** Contribution suggestion line. */
export function goalSuggestionLine(
  goal: Pick<
    FinancialGoal,
    | "contribution_recommendation"
    | "monthly_required"
    | "recommended_monthly_contribution"
    | "suggested_monthly"
    | "forecast_gap"
    | "pace_status"
  >
): string | null {
  if (goal.contribution_recommendation) return goal.contribution_recommendation;
  const monthly = goal.monthly_required ?? goal.suggested_monthly ?? goal.recommended_monthly_contribution;
  if (monthly && parseFloat(monthly) > 0) {
    return `Add ${formatCurrency(monthly)}/month to stay on pace`;
  }
  if (goal.forecast_gap && parseFloat(goal.forecast_gap) > 0) {
    return `Add ${formatCurrency(goal.forecast_gap)}/month to stay on pace`;
  }
  if (goal.pace_status === "behind") {
    return "Current pace is too slow to reach your target date.";
  }
  return null;
}

export function goalFundingLine(
  goal: Pick<
    FinancialGoal,
    | "funding_account"
    | "funding_account_name"
    | "funding_source_label"
    | "linked_account_name"
    | "automatic_transfer_label"
    | "has_automatic_funding"
  >
): { source: string | null; transfer: string | null } {
  const account =
    goal.funding_account_name ??
    goal.funding_account ??
    goal.linked_account_name ??
    null;
  const source = account ? `Funded from ${account}` : goal.funding_source_label ?? null;
  let transfer = goal.automatic_transfer_label ?? null;
  if (!transfer && goal.has_automatic_funding === false) {
    transfer = "No automatic funding configured";
  }
  return { source, transfer };
}

export function parseProgressForBar(progressPercent: string): number {
  const n = parseFloat(progressPercent);
  return Number.isFinite(n) ? Math.min(100, Math.max(0, n)) : 0;
}
