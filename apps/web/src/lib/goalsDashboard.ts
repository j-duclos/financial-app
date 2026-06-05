import type { FinancialGoal, FinancialGoalStatus } from "@budget-app/shared";

const STATUS_ORDER: Record<FinancialGoalStatus, number> = {
  active: 0,
  paused: 1,
  completed: 2,
  archived: 3,
};

const PRIORITY_ORDER: Record<string, number> = {
  high: 0,
  medium: 1,
  low: 2,
};

function prioritySortKey(priority: FinancialGoal["priority"] | string | undefined): number {
  if (typeof priority === "number" && Number.isFinite(priority)) return priority;
  if (typeof priority === "string") return PRIORITY_ORDER[priority] ?? 9;
  return 2;
}

/** Every user goal for dashboard lists (active, paused, completed, archived). */
export function goalsForDashboard(goals: FinancialGoal[]): FinancialGoal[] {
  return [...goals].sort((a, b) => {
    const sa = STATUS_ORDER[a.status] ?? 9;
    const sb = STATUS_ORDER[b.status] ?? 9;
    if (sa !== sb) return sa - sb;
    const pa = prioritySortKey(a.priority);
    const pb = prioritySortKey(b.priority);
    if (pa !== pb) return pa - pb;
    return a.name.localeCompare(b.name);
  });
}

/** Active/paused only — for snapshot savings footers and contribute defaults. */
export function activeGoalsForDashboard(goals: FinancialGoal[]): FinancialGoal[] {
  return goalsForDashboard(goals).filter(
    (g) => g.status === "active" || g.status === "paused"
  );
}

/** Top N active/paused goals by priority for dashboard cards. */
export function topActiveGoalsForDashboard(
  goals: FinancialGoal[],
  limit = 3
): FinancialGoal[] {
  return activeGoalsForDashboard(goals).slice(0, limit);
}

/** Dashboard goal cards: 1 full width, 2 per row, up to 3 per row before wrapping. */
export function goalsDashboardGridClass(goalCount: number): string {
  const base = "grid gap-3 w-full";
  if (goalCount <= 1) return `${base} grid-cols-1`;
  if (goalCount === 2) return `${base} grid-cols-1 sm:grid-cols-2`;
  return `${base} grid-cols-1 sm:grid-cols-2 lg:grid-cols-3`;
}
