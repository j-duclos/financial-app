import type { DebtPayoffPlan, DebtPayoffStrategy, DebtPayoffMode } from "@budget-app/shared";
import { formatCurrency } from "@budget-app/shared";
import { formatDateDisplay } from "./dateDisplay";

export const DEBT_STRATEGY_OPTIONS: Array<{
  id: DebtPayoffStrategy;
  label: string;
  description: string;
}> = [
  { id: "avalanche", label: "Avalanche", description: "Highest APR first — saves the most interest" },
  { id: "snowball", label: "Snowball", description: "Smallest balance first — quick wins" },
  {
    id: "utilization_target",
    label: "Credit score",
    description: "Lower utilization on high-limit cards first",
  },
  { id: "custom", label: "Custom order", description: "Your priority order" },
];

export const DEBT_MODE_OPTIONS: Array<{
  id: DebtPayoffMode;
  label: string;
  description: string;
}> = [
  { id: "survival", label: "Survival", description: "Minimum payments only" },
  { id: "aggressive", label: "Aggressive payoff", description: "Minimums + extra monthly" },
  { id: "credit_score", label: "Credit score focus", description: "Prioritize utilization" },
  { id: "balanced", label: "Balanced", description: "Moderate extra while keeping cash" },
];

export function debtStrategyDescription(strategy: DebtPayoffStrategy): string {
  return DEBT_STRATEGY_OPTIONS.find((o) => o.id === strategy)?.description ?? "";
}

export function debtModeDescription(mode: DebtPayoffMode): string {
  return DEBT_MODE_OPTIONS.find((o) => o.id === mode)?.description ?? "";
}

export function debtStrategyLabel(strategy: DebtPayoffStrategy): string {
  return DEBT_STRATEGY_OPTIONS.find((o) => o.id === strategy)?.label ?? "";
}

export function debtModeLabel(mode: DebtPayoffMode): string {
  return DEBT_MODE_OPTIONS.find((o) => o.id === mode)?.label ?? "";
}

export function debtFreeHeadline(plan: DebtPayoffPlan | null | undefined): string {
  if (!plan) return "";
  if (Decimal(plan.total_debt) <= 0) return "You're credit card debt free.";
  if (!plan.debt_free_possible) return "Increase payments to reach a payoff date.";
  if (plan.debt_free_date) {
    return `Debt-free by ${formatDateDisplay(plan.debt_free_date)}`;
  }
  return "";
}

function Decimal(s: string): number {
  return parseFloat(s) || 0;
}

export function formatDebtFreeMonths(plan: DebtPayoffPlan): string | null {
  if (plan.months_to_debt_free == null) return null;
  const m = plan.months_to_debt_free;
  return `${m} month${m === 1 ? "" : "s"}`;
}

export function interestSavedLine(plan: DebtPayoffPlan): string | null {
  const saved = Decimal(plan.interest_saved_vs_minimums);
  if (saved <= 0) return null;
  return `Save ${formatCurrency(plan.interest_saved_vs_minimums)} interest vs minimums only`;
}

export function cardPayoffTagline(
  card: DebtPayoffPlan["cards"][0],
  currency = "USD"
): string {
  const parts: string[] = [];
  if (card.months_remaining != null && card.months_remaining > 0) {
    parts.push(`Payoff in ${card.months_remaining} mo`);
  }
  if (card.total_projected_interest) {
    parts.push(`${formatCurrency(card.total_projected_interest, currency)} interest`);
  }
  return parts.join(" · ");
}
