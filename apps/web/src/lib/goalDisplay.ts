import type {
  DashboardGoalSummary,
  FinancialGoal,
  FinancialGoalType,
  GoalHealthStatus,
  GoalOnTrackStatus,
} from "@budget-app/shared";
import { formatCurrency } from "@budget-app/shared";

export const BUCKET_TYPE_LABELS: Record<string, string> = {
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

export const GOAL_TYPE_LABELS: Record<string, string> = BUCKET_TYPE_LABELS;

export const GOAL_TYPE_ICONS: Record<string, string> = {
  emergency: "🛡️",
  emergency_fund: "🛡️",
  savings: "💰",
  debt_payoff: "💳",
  house: "🏠",
  house_down_payment: "🏠",
  education: "🎓",
  college: "🎓",
  vacation: "✈️",
  purchase: "🛒",
  car: "🚗",
  taxes: "📋",
  retirement: "🏦",
  custom: "🎯",
};

/** Goal bucket types for create/edit form. */
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

export const FORECAST_STATUS_LABELS: Record<string, string> = {
  ahead: "Ahead",
  on_track: "On track",
  behind: "Behind",
  never: "Never (no pace)",
  completed: "Completed",
};

export function isDebtGoalType(goalType: string): boolean {
  return goalType === "debt_payoff";
}

export function formatGoalProgressLine(goal: DashboardGoalSummary | FinancialGoal): string {
  if (goal.is_debt_goal) {
    const owed = goal.linked_debt_balance ?? goal.remaining_amount;
    return `${formatCurrency(owed)} owed`;
  }
  return `${formatCurrency(goal.current_amount)} / ${formatCurrency(goal.target_amount)}`;
}

import { formatDateDisplay } from "./dateDisplay";

export function formatProjectedCompletion(iso: string | null | undefined): string | null {
  if (!iso) return null;
  return formatDateDisplay(iso);
}

export function onTrackBadgeClass(status: string): string {
  switch (status) {
    case "ahead":
      return "bg-green-100 text-green-800";
    case "on_track":
      return "bg-blue-100 text-blue-800";
    case "behind":
      return "bg-amber-100 text-amber-800";
    default:
      return "bg-gray-100 text-gray-600";
  }
}

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

export function goalHealthBadgeClass(health: GoalHealthStatus | string | undefined): string {
  switch (health) {
    case "ahead":
      return "bg-green-100 text-green-800";
    case "on_track":
      return "bg-blue-100 text-blue-800";
    case "watch":
      return "bg-amber-50 text-amber-800";
    case "behind":
      return "bg-red-100 text-red-800";
    case "completed":
      return "bg-emerald-100 text-emerald-800";
    default:
      return "bg-gray-100 text-gray-600";
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

/** Display status for card header — prefers goal_health, falls back to on_track. */
export function goalStatusDisplay(goal: Pick<FinancialGoal, "goal_health" | "on_track_status">): {
  label: string;
  className: string;
} | null {
  if (goal.goal_health && goal.goal_health !== "no_schedule") {
    return { label: goalHealthLabel(goal.goal_health).toUpperCase(), className: goalHealthBadgeClass(goal.goal_health) };
  }
  const track = onTrackLabel(goal.on_track_status);
  if (!track) return null;
  return { label: track.toUpperCase(), className: onTrackBadgeClass(goal.on_track_status) };
}

export function goalContributionHint(
  goal: Pick<
    DashboardGoalSummary,
    | "on_track_status"
    | "recommended_monthly_contribution"
    | "target_date"
    | "projected_completion_date"
    | "monthly_required"
  >
): string | null {
  const monthly = goal.monthly_required ?? goal.recommended_monthly_contribution;
  const target = goal.target_date ? formatProjectedCompletion(goal.target_date) : null;
  if (monthly && parseFloat(monthly) > 0) {
    if (target) {
      return `Need ${formatCurrency(monthly)}/mo to hit ${target}`;
    }
    return `Need ${formatCurrency(monthly)}/mo`;
  }
  const projected = formatProjectedCompletion(goal.projected_completion_date);
  if (projected) {
    return `Reach in ${projected}`;
  }
  return null;
}

export function parseProgressPercent(value: string): number {
  const n = parseFloat(value);
  return Number.isFinite(n) ? Math.min(100, Math.max(0, n)) : 0;
}

/** Rounded percent for dashboard compact rows. */
export function dashboardGoalPercent(progressPercent: string): number {
  return Math.round(parseProgressPercent(progressPercent));
}

export function progressBarBlocks(pct: number, blocks = 16): string {
  const filled = Math.round((pct / 100) * blocks);
  return "█".repeat(filled) + "░".repeat(blocks - filled);
}

export function formatMonthlyAmount(amount: string | null | undefined): string | null {
  if (!amount || parseFloat(amount) <= 0) return null;
  return `${formatCurrency(amount)}/mo`;
}

export function mapOnTrackToHealth(onTrack: GoalOnTrackStatus): GoalHealthStatus {
  if (onTrack === "ahead") return "ahead";
  if (onTrack === "on_track") return "on_track";
  if (onTrack === "behind") return "behind";
  return "no_schedule";
}
