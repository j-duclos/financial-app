import type {
  Account,
  TimelineCalendarDay,
  TransferSimulationResult,
  TransferSimulationResultStatus,
} from "@budget-app/shared";
import { parseAmount } from "./timelineCalendarUtils";

/** Accounts that can fund a corrective transfer (cash / savings). */
export function transferSourceAccounts(accounts: Account[]): Account[] {
  return accounts.filter((a) => {
    const t = (a.account_type || "").toUpperCase();
    return t === "CHECKING" || t === "SAVINGS" || t === "CASH";
  });
}

/** Impacted account for simulation (lowest-balance marker or first checking). */
export function resolveImpactedAccountId(
  day: TimelineCalendarDay,
  accounts: Account[]
): number | null {
  const markerId = day.lowest_projected_balance_account_id;
  if (markerId != null) return Number(markerId);
  const checking = accounts.find((a) => a.account_type === "CHECKING");
  return checking?.id ?? accounts[0]?.id ?? null;
}

/** Suggested transfer amount to cover deficit on focus day (+ optional buffer). */
export function suggestTransferAmount(day: TimelineCalendarDay, toAccount?: Account): string {
  const lowest = parseAmount(day.lowest_projected_balance);
  if (lowest >= 0) {
    const below = parseAmount(day.below_buffer_amount);
    if (below > 0) return below.toFixed(2);
    return "100.00";
  }
  const buffer = toAccount?.minimum_buffer
    ? parseAmount(String(toAccount.minimum_buffer))
    : 0;
  const cover = Math.abs(lowest) + buffer;
  return cover > 0 ? cover.toFixed(2) : "100.00";
}

export function shouldShowTransferSimulation(day: TimelineCalendarDay): boolean {
  if (day.has_risk) return true;
  if (day.is_negative) return true;
  const level = day.heat_level;
  if (level === "dangerous" || level === "tight") return true;
  if (parseAmount(day.below_buffer_amount) > 0) return true;
  if (parseAmount(day.lowest_projected_balance) < 0) return true;
  return false;
}

export function simulationStatusLabel(status: TransferSimulationResultStatus): string {
  switch (status) {
    case "resolved":
      return "Risk resolved";
    case "partial":
      return "Still tight";
    case "failed":
      return "Still projected negative";
    default:
      return status;
  }
}

export function simulationStatusClass(status: TransferSimulationResultStatus): string {
  switch (status) {
    case "resolved":
      return "border-emerald-300 bg-emerald-50 text-emerald-900";
    case "partial":
      return "border-amber-300 bg-amber-50 text-amber-900";
    case "failed":
      return "border-red-300 bg-red-50 text-red-900";
    default:
      return "border-gray-200 bg-gray-50 text-gray-900";
  }
}

export function formatSimulationDelta(
  base: string | null | undefined,
  simulated: string | null | undefined
): { improved: boolean; delta: number | null } {
  if (base == null || simulated == null) return { improved: false, delta: null };
  const b = parseAmount(base);
  const s = parseAmount(simulated);
  return { improved: s > b, delta: s - b };
}

export type TransferSimulationRequest = {
  from_account_id: number;
  to_account_id: number;
  amount: string;
  transfer_date: string;
  focus_date: string;
  horizon: "14d" | "3m" | "6m" | "12m" | "18m" | "24m" | "36m";
  household_id?: number;
  scenario_id?: number | null;
};

export function buildSimulationRequest(
  params: TransferSimulationRequest
): TransferSimulationRequest {
  return params;
}

export function pickDefaultSourceAccount(
  sources: Account[],
  toAccountId: number
): number | "" {
  const savings = sources.find(
    (a) => a.id !== toAccountId && a.account_type === "SAVINGS"
  );
  if (savings) return savings.id;
  const other = sources.find((a) => a.id !== toAccountId);
  return other?.id ?? "";
}
