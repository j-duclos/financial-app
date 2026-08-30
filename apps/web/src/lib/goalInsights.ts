import type { FinancialGoal, GoalPaceStatus } from "@budget-app/shared";
import { formatCurrency } from "@budget-app/shared";
import { formatMonthYear } from "./dateDisplay";
import { formatGoalProgressLine, formatMonthlyAmount } from "./goalDisplay";

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

/** Progress line with funding account, e.g. "Funded from Savings: $1,551.62 / $30,000.00". */
export function goalFundedProgressLine(goal: FinancialGoal): string {
  const progress = formatGoalProgressLine(goal);
  if (goal.is_debt_goal) return progress;
  const { source } = goalFundingLine(goal);
  return source ? `${source}: ${progress}` : progress;
}

/** Configured paycheck deposit, not the suggested amount needed to hit the date. */
export function goalCurrentDepositValue(goal: FinancialGoal): string | null {
  const rules = goal.linked_rules ?? [];
  if (rules.length > 0) {
    return rules.map((rule) => rule.label).filter(Boolean).join("; ") || null;
  }
  const label = goal.automatic_transfer_label?.trim();
  if (!label) return null;
  if (/^no automatic funding/i.test(label)) return null;
  return label.replace(/^Paycheck funding:\s*/i, "").replace(/^Planned:\s*/i, "") || null;
}

export type GoalCardMetric = {
  label: string;
  value: string;
  emphasize?: boolean;
};

function parseMoney(value: string | null | undefined): number | null {
  if (value == null || value === "") return null;
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : null;
}

function formatPaceMonthly(amount: string | null | undefined): string | null {
  const n = parseMoney(amount);
  if (n == null || n < 0) return null;
  return `${formatCurrency(amount as string)}/mo`;
}

/** Saved vs target line for Goal Details (not the Goals card). */
export function goalDetailProgressLine(goal: FinancialGoal): string {
  if (goal.is_debt_goal) {
    return formatGoalProgressLine(goal);
  }
  return `${formatCurrency(goal.current_amount)} of ${formatCurrency(goal.target_amount)}`;
}

export function goalDetailFunding(goal: FinancialGoal): {
  account: string | null;
  automatic: string | null;
} {
  const account =
    goal.funding_account_name ?? goal.funding_account ?? goal.linked_account_name ?? null;
  let automatic = goalCurrentDepositValue(goal);
  if (automatic && !/from paycheck/i.test(automatic) && (goal.linked_rules?.length ?? 0) > 0) {
    automatic = `${automatic} from paycheck`;
  }
  if (!automatic && goal.has_automatic_funding === false) {
    automatic = "Not configured";
  }
  return { account, automatic };
}

/** Per-paycheck needed from the actual paycheck schedule — never a hardcoded biweekly fallback. */
export function goalPerPaycheckNeeded(goal: FinancialGoal): string | null {
  const amount = parseMoney(goal.suggested_per_paycheck);
  if (amount == null || amount <= 0) return null;
  return formatCurrency(goal.suggested_per_paycheck as string);
}

export type GoalForecastSummaryMetric = {
  label: string;
  value: string;
  tone?: "shortfall" | "surplus";
};

/** Compact Goal Details forecast figures from canonical backend fields. */
export function goalForecastSummary(goal: FinancialGoal): GoalForecastSummaryMetric[] {
  const rows: GoalForecastSummaryMetric[] = [];
  const target = formatMonthYear(goal.target_date);
  if (target) {
    rows.push({ label: "Target date", value: target });
  }
  const projected = formatMonthYear(goal.projected_completion_date);
  if (projected) {
    rows.push({ label: "Projected completion", value: projected });
  }

  const monthlyNeeded = formatMonthlyAmount(goal.monthly_required ?? goal.suggested_monthly);
  if (monthlyNeeded) {
    rows.push({ label: "Monthly needed", value: monthlyNeeded });
  }

  const pace = formatPaceMonthly(
    goal.current_contribution_rate ?? goal.contribution_pace_monthly
  );
  if (pace) {
    rows.push({ label: "Current pace", value: pace });
  }

  // Shortfall/surplus are backend-owned — never derive from needed − pace on the client.
  const backendShortfall = parseMoney(goal.forecast_gap);
  const backendSurplus = parseMoney(goal.forecast_surplus);

  if (backendSurplus != null && backendSurplus > 0.005) {
    const surplus = formatPaceMonthly(goal.forecast_surplus);
    if (surplus) rows.push({ label: "Surplus", value: surplus, tone: "surplus" });
  } else if (backendShortfall != null && backendShortfall > 0.005) {
    const shortfall = formatPaceMonthly(goal.forecast_gap);
    if (shortfall) rows.push({ label: "Shortfall", value: shortfall, tone: "shortfall" });
  }

  const perPaycheck = goalPerPaycheckNeeded(goal);
  if (perPaycheck) {
    rows.push({ label: "Per paycheck needed", value: perPaycheck });
  }

  return rows;
}

/** Monthly gap for the Goals list card (shown beside the recommendation). */
export function goalCardGapValue(goal: FinancialGoal): string | null {
  if (goal.forecast_gap && parseFloat(goal.forecast_gap) > 0) {
    return formatMonthlyAmount(goal.forecast_gap);
  }
  return null;
}

/** Forecast figures shown on the main Goals card (no separate forecast modal). */
export function goalCardMetrics(goal: FinancialGoal): GoalCardMetric[] {
  const rows: GoalCardMetric[] = [];
  const target = formatMonthYear(goal.target_date);
  if (target) {
    rows.push({ label: "Target date", value: target });
  }
  const projected = formatMonthYear(goal.projected_completion_date);
  if (projected) {
    rows.push({ label: "Projected date", value: projected });
  }
  const pace = formatMonthlyAmount(goal.current_contribution_rate ?? goal.contribution_pace_monthly);
  if (pace) {
    rows.push({ label: "Current monthly pace", value: pace });
  }
  const required = formatMonthlyAmount(goal.monthly_required ?? goal.suggested_monthly);
  if (required) {
    rows.push({ label: "Monthly needed", value: required });
  }
  return rows;
}

/** Goal Details header table — excludes per-paycheck (shown below the table). */
export function goalDetailForecastTable(goal: FinancialGoal): GoalForecastSummaryMetric[] {
  return goalForecastSummary(goal).filter((row) => row.label !== "Per paycheck needed");
}
