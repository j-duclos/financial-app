import type { DashboardSnapshot } from "@budget-app/shared";

export const SNAPSHOT_LINKS = {
  cash: "/accounts?cashOnly=1",
  debt: "/accounts?debtOnly=1",
  savings: "/accounts?savingsOnly=1",
  net: "/reports",
} as const;

export const SNAPSHOT_UNAVAILABLE = "Not available";

export function formatPctChange(pct: string | null | undefined): string | null {
  if (pct == null || pct === "") return null;
  const n = parseFloat(pct);
  if (!Number.isFinite(n)) return null;
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(1)}% vs last month`;
}

/** Compact trend for snapshot strip footers (↑ 2.1% / ↓ 4.5%). */
export function formatTrendPct(pct: string | null | undefined): string | null {
  if (pct == null || pct === "") return null;
  const n = parseFloat(pct);
  if (!Number.isFinite(n) || n === 0) return null;
  const arrow = n > 0 ? "↑" : "↓";
  return `${arrow} ${Math.abs(n).toFixed(1)}%`;
}

export function pctTrendClass(pct: string | null | undefined): string {
  if (pct == null) return "text-gray-400";
  const n = parseFloat(pct);
  if (!Number.isFinite(n) || n === 0) return "text-gray-500";
  return n > 0 ? "text-green-600" : "text-red-600";
}

export function utilizationLabel(util: string | null | undefined): string | null {
  if (util == null || util === "") return null;
  const n = parseFloat(util);
  if (!Number.isFinite(n)) return null;
  return `Utilization ${n.toFixed(0)}%`;
}

export function savingsGoalFooter(snapshot: DashboardSnapshot): string | null {
  const pct = snapshot.savings_goal_progress_pct;
  if (pct == null || pct === "") return null;
  const n = parseFloat(pct);
  if (!Number.isFinite(n)) return null;
  const sign = n >= 0 ? "+" : "";
  return `Goal progress ${sign}${n.toFixed(0)}%`;
}

export function netPositionFooter(snapshot: DashboardSnapshot): string {
  return formatTrendPct(snapshot.net_position_change_pct) ?? SNAPSHOT_UNAVAILABLE;
}

export function snapshotMetricAvailable(value: string | null | undefined): boolean {
  return value != null && value !== "";
}

/** Ledger stores credit debt as a positive amount; display as negative liability. */
export function debtDisplayAmount(creditDebt: string): string {
  const n = parseFloat(creditDebt);
  if (!Number.isFinite(n)) return creditDebt;
  if (n === 0) return "0";
  return String(-Math.abs(n));
}

export function cashSnapshotFooter(snapshot: DashboardSnapshot): string | null {
  return formatTrendPct(snapshot.cash_change_pct) ?? formatPctChange(snapshot.cash_change_pct);
}

export function savingsSnapshotFooter(snapshot: DashboardSnapshot): string | null {
  return savingsGoalFooter(snapshot) ?? formatTrendPct(snapshot.savings_change_pct);
}
