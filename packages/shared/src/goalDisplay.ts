import type {
  DashboardGoalSummary,
  FinancialGoal,
  FinancialGoalStatus,
  FinancialGoalType,
  GoalHealthStatus,
  GoalOnTrackStatus,
  GoalPaceStatus,
} from "./types";
import { formatCurrency } from "./utils";
import { formatMonthYear, formatShortMonthDay } from "./dateDisplay";

export const GOAL_TYPE_OPTIONS: { value: FinancialGoalType; label: string }[] = [
  { value: "emergency", label: "Emergency fund" },
  { value: "vacation", label: "Vacation" },
  { value: "house", label: "House down payment" },
  { value: "education", label: "Education" },
  { value: "debt_payoff", label: "Debt payoff" },
  { value: "purchase", label: "Purchase" },
  { value: "retirement", label: "Retirement" },
  { value: "custom", label: "Custom" },
];

export const GOAL_TYPE_LABELS: Record<string, string> = {
  emergency: "Emergency fund",
  purchase: "Purchase",
  vacation: "Vacation",
  house: "House down payment",
  education: "Education",
  debt_payoff: "Debt payoff",
  retirement: "Retirement",
  custom: "Custom",
  savings: "Savings",
  emergency_fund: "Emergency fund",
  house_down_payment: "House down payment",
  college: "Education",
  car: "Purchase",
  taxes: "Purchase",
};

export function isDebtGoalType(goalType: string): boolean {
  return goalType === "debt_payoff";
}

export function goalTypeLabel(goalType: string): string {
  return GOAL_TYPE_LABELS[goalType] ?? goalType;
}

export const FORECAST_STATUS_LABELS: Record<string, string> = {
  ahead: "Ahead",
  on_track: "On track",
  behind: "Behind",
  never: "Never (no pace)",
  completed: "Completed",
};

export function onTrackLabel(status: string): string {
  switch (status) {
    case "ahead":
      return "Ahead";
    case "on_track":
      return "On track";
    case "behind":
      return "Behind";
    default:
      return "";
  }
}

export function goalHealthLabel(health: GoalHealthStatus | string | undefined): string {
  switch (health) {
    case "ahead":
      return "Ahead";
    case "on_track":
      return "On track";
    case "watch":
      return "Watch";
    case "behind":
      return "Behind";
    case "completed":
      return "Completed";
    case "no_schedule":
      return "No schedule";
    default:
      return "";
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

export type GoalStatusTone = "positive" | "warning" | "critical" | "neutral";

export function paceStatusTone(pace: GoalPaceStatus | string | undefined): GoalStatusTone {
  switch (pace) {
    case "ahead":
    case "on_track":
    case "completed":
      return "positive";
    case "behind":
      return "warning";
    case "stalled":
      return "critical";
    default:
      return "neutral";
  }
}

export function onTrackTone(status: GoalOnTrackStatus | string | undefined): GoalStatusTone {
  switch (status) {
    case "ahead":
    case "on_track":
      return "positive";
    case "behind":
      return "warning";
    default:
      return "neutral";
  }
}

/** List/detail status — lifecycle status first, then pace/on-track. */
export function goalListStatusDisplay(
  goal: Pick<FinancialGoal, "status" | "pace_status" | "on_track_status">
): { label: string; tone: GoalStatusTone } | null {
  if (goal.status === "paused") return { label: "PAUSED", tone: "neutral" };
  if (goal.status === "completed") return { label: "COMPLETED", tone: "positive" };
  if (goal.status === "archived") return { label: "ARCHIVED", tone: "neutral" };
  const pace = paceStatusLabel(goal.pace_status);
  if (pace) return { label: pace.toUpperCase(), tone: paceStatusTone(goal.pace_status) };
  const track = onTrackLabel(goal.on_track_status);
  if (!track) return null;
  return { label: track.toUpperCase(), tone: onTrackTone(goal.on_track_status) };
}

/** Primary projection line (API headline or fallback). */
export function goalProjectionLine(
  goal: Pick<
    FinancialGoal,
    "projection_headline" | "pace_status" | "projected_completion_date" | "target_date" | "on_track_status"
  >
): string {
  if (goal.projection_headline) return goal.projection_headline;
  if (goal.pace_status === "stalled") return "No funding activity yet";
  return "";
}

/** Contribution suggestion — prefers API recommendation. */
export function goalSuggestionLine(
  goal: Pick<
    FinancialGoal,
    | "contribution_recommendation"
    | "monthly_required"
    | "recommended_monthly_contribution"
    | "suggested_monthly"
    | "forecast_gap"
    | "pace_status"
    | "on_track_status"
  >
): string | null {
  if (goal.contribution_recommendation) return goal.contribution_recommendation;
  return dashboardGoalContributionLine(goal);
}

export function goalDetailProgressLine(goal: FinancialGoal): string {
  if (goal.is_debt_goal) return formatGoalProgressLine(goal);
  return `${formatCurrency(goal.current_amount)} of ${formatCurrency(goal.target_amount)}`;
}

export type GoalForecastRow = {
  label: string;
  value: string;
  tone?: "shortfall" | "surplus";
};

function formatMonthlyAmount(amount: string | null | undefined): string | null {
  if (!amount || parseFloat(amount) <= 0) return null;
  return `${formatCurrency(amount)}/mo`;
}

/** Compact forecast figures for goal detail. */
export function goalDetailForecastRows(goal: FinancialGoal): GoalForecastRow[] {
  const rows: GoalForecastRow[] = [];
  const target = formatGoalTargetDate(goal.target_date);
  if (target) rows.push({ label: "Target date", value: target });
  const projected = formatGoalTargetDate(goal.projected_completion_date);
  if (projected) rows.push({ label: "Projected completion", value: projected });
  const monthlyNeeded = formatMonthlyAmount(goal.monthly_required ?? goal.suggested_monthly);
  if (monthlyNeeded) rows.push({ label: "Monthly needed", value: monthlyNeeded });
  const pace = formatMonthlyAmount(goal.current_contribution_rate ?? goal.contribution_pace_monthly);
  if (pace) rows.push({ label: "Current pace", value: pace });
  const gap = goal.forecast_gap;
  const surplus = goal.forecast_surplus;
  if (surplus && parseFloat(surplus) > 0.005) {
    const s = formatMonthlyAmount(surplus);
    if (s) rows.push({ label: "Surplus", value: s, tone: "surplus" });
  } else if (gap && parseFloat(gap) > 0.005) {
    const g = formatMonthlyAmount(gap);
    if (g) rows.push({ label: "Shortfall", value: g, tone: "shortfall" });
  }
  return rows;
}

export function goalLinkedAccountId(goal: FinancialGoal): number | null {
  return goal.linked_account ?? goal.linked_credit_account ?? goal.funding_account_id ?? null;
}

export function goalLinkedAccountName(goal: FinancialGoal): string | null {
  return (
    goal.linked_account_name ??
    goal.linked_credit_account_name ??
    goal.funding_account_name ??
    null
  );
}

export function goalPerPaycheckNeeded(
  goal: Pick<FinancialGoal, "suggested_per_paycheck">
): string | null {
  const amount = goal.suggested_per_paycheck;
  if (!amount || parseFloat(amount) <= 0) return null;
  return formatCurrency(amount);
}

/** Dashboard card status — prefers pace_status, falls back to on_track_status. */
export function dashboardGoalStatusDisplay(
  goal: Pick<DashboardGoalSummary, "pace_status" | "on_track_status" | "goal_health">
): { label: string; tone: GoalStatusTone } | null {
  const pace = paceStatusLabel(goal.pace_status);
  if (pace) {
    return { label: pace.toUpperCase(), tone: paceStatusTone(goal.pace_status) };
  }
  const track = onTrackLabel(goal.on_track_status);
  if (!track) return null;
  return { label: track.toUpperCase(), tone: onTrackTone(goal.on_track_status) };
}

export function formatGoalProgressLine(goal: DashboardGoalSummary | FinancialGoal): string {
  if (goal.is_debt_goal) {
    const owed = goal.linked_debt_balance ?? goal.remaining_amount;
    return `${formatCurrency(owed)} owed`;
  }
  return `${formatCurrency(goal.current_amount)} / ${formatCurrency(goal.target_amount)}`;
}

export function formatProjectedCompletion(iso: string | null | undefined): string | null {
  if (!iso) return null;
  return formatShortMonthDay(iso);
}

export function formatGoalTargetDate(iso: string | null | undefined): string | null {
  return formatMonthYear(iso);
}

export function parseProgressPercent(value: string): number {
  const n = parseFloat(value);
  return Number.isFinite(n) ? Math.min(100, Math.max(0, n)) : 0;
}

export function dashboardGoalPercent(progressPercent: string): number {
  return Math.round(parseProgressPercent(progressPercent));
}

/** Contribution line for dashboard cards — uses API recommendation when present. */
export function dashboardGoalContributionLine(
  goal: Pick<
    DashboardGoalSummary,
    | "contribution_recommendation"
    | "monthly_required"
    | "recommended_monthly_contribution"
    | "pace_status"
    | "on_track_status"
  >
): string | null {
  if (goal.contribution_recommendation) return goal.contribution_recommendation;
  const monthly = goal.monthly_required ?? goal.recommended_monthly_contribution;
  if (monthly && parseFloat(monthly) > 0) {
    const pace = goal.pace_status ?? goal.on_track_status;
    if (pace === "on_track" || pace === "ahead") {
      return `Continue ${formatCurrency(monthly)}/month to stay on pace`;
    }
    if (pace === "behind" || pace === "stalled") {
      return `Need ${formatCurrency(monthly)}/month to reach your target date`;
    }
    return `Need ${formatCurrency(monthly)}/month`;
  }
  return null;
}
