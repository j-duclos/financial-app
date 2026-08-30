import type { QueryClient } from "@tanstack/react-query";
import type { FinancialGoal, FinancialGoalType } from "@budget-app/shared";
import type { GoalFundingFormState } from "./goalFundingForm";

/**
 * Intent-specific Goals invalidation for Web — mirrors mobile
 * `apps/mobile/features/goals/queryKeys.ts` helpers.
 *
 * Broader invalidation that remains by design:
 * - Goal roots include `goals-report` (list/summary consumers share overview math).
 * - Lifecycle / funding / metadata include dashboard (+ forecast expands to accounts)
 *   because goal status and funding change safe-to-spend.
 * - Does NOT invalidate `account-options`, ledger, or recurring rules unless the
 *   intent can affect them (funding / contribution).
 */

/** Minimal save payload shape for impact classification (matches GoalFormValues). */
export type GoalSaveImpactInput = {
  name: string;
  description: string;
  goal_type: FinancialGoalType;
  target_amount: string;
  target_date: string;
  linked_account: number | "";
  linked_credit_account: number | "";
  monthly_contribution: string;
  priority: number;
  include_in_safe_to_spend: boolean;
  forecast_enabled: boolean;
  auto_fund_enabled: boolean;
  notes: string;
  funding: GoalFundingFormState;
};

function invalidateGoalRoots(queryClient: QueryClient): void {
  void queryClient.invalidateQueries({ queryKey: ["buckets"] });
  void queryClient.invalidateQueries({ queryKey: ["bucket-detail"] });
  void queryClient.invalidateQueries({ queryKey: ["goal-contributions"] });
  void queryClient.invalidateQueries({ queryKey: ["buckets-summary"] });
  void queryClient.invalidateQueries({ queryKey: ["goals-report"] });
}

function invalidateDashboardQueries(queryClient: QueryClient): void {
  void queryClient.invalidateQueries({ queryKey: ["dashboard-summary"] });
  void queryClient.invalidateQueries({ queryKey: ["dashboard-summary-fast"] });
  void queryClient.invalidateQueries({ queryKey: ["dashboard-summary-details"] });
  void queryClient.invalidateQueries({ queryKey: ["extended-cash-risk"] });
}

function invalidateForecastQueries(queryClient: QueryClient): void {
  invalidateDashboardQueries(queryClient);
  void queryClient.invalidateQueries({ queryKey: ["recommendations"] });
  void queryClient.invalidateQueries({ queryKey: ["debt-plan"] });
  void queryClient.invalidateQueries({ queryKey: ["account-payoff"] });
  // Forecast dependents include account balances used by safe-to-spend — not account-options.
  void queryClient.invalidateQueries({ queryKey: ["accounts"] });
  void queryClient.invalidateQueries({ queryKey: ["account"] });
}

function invalidateLedgerQueries(queryClient: QueryClient): void {
  void queryClient.invalidateQueries({ queryKey: ["transactions"] });
  void queryClient.invalidateQueries({ queryKey: ["timeline"] });
  void queryClient.invalidateQueries({ queryKey: ["calendar-summary"] });
  void queryClient.invalidateQueries({ queryKey: ["calendar-chunk"] });
}

/** Name, notes, target date, priority — not forecast plumbing / ledger / rules. */
export function invalidateGoalMetadataQueries(queryClient: QueryClient): void {
  invalidateGoalRoots(queryClient);
  invalidateDashboardQueries(queryClient);
}

/** Real contribution / withdrawal — may touch ledger and reports. */
export function invalidateGoalContributionQueries(queryClient: QueryClient): void {
  invalidateGoalRoots(queryClient);
  invalidateDashboardQueries(queryClient);
  void queryClient.invalidateQueries({ queryKey: ["monthly-reports"] });
  invalidateLedgerQueries(queryClient);
  invalidateForecastQueries(queryClient);
}

/** Funding rule / allocation / planned contribution changes. */
export function invalidateGoalFundingQueries(queryClient: QueryClient): void {
  invalidateGoalMetadataQueries(queryClient);
  invalidateForecastQueries(queryClient);
  invalidateLedgerQueries(queryClient);
  void queryClient.invalidateQueries({ queryKey: ["rule-allocations"] });
  void queryClient.invalidateQueries({ queryKey: ["rules"] });
  void queryClient.invalidateQueries({ queryKey: ["recurring-rules"] });
}

/**
 * Lifecycle (pause, complete, archive, duplicate, delete) — status affects
 * safe-to-spend / forecast. Does not invalidate ledger or rule allocations.
 */
export function invalidateGoalLifecycleQueries(queryClient: QueryClient): void {
  invalidateGoalMetadataQueries(queryClient);
  invalidateForecastQueries(queryClient);
}

function normMoney(value: string | null | undefined): string {
  const n = parseFloat(value ?? "0");
  return Number.isFinite(n) ? n.toFixed(2) : "0.00";
}

function fundingStateChanged(
  before: GoalFundingFormState | undefined,
  after: GoalFundingFormState
): boolean {
  if (!before) {
    return after.enabled || after.incomeRuleId !== "" || after.fixedAmount !== "" || after.percent !== "";
  }
  return (
    before.enabled !== after.enabled ||
    before.incomeRuleId !== after.incomeRuleId ||
    before.amountMode !== after.amountMode ||
    normMoney(before.fixedAmount) !== normMoney(after.fixedAmount) ||
    normMoney(before.percent) !== normMoney(after.percent)
  );
}

/**
 * Classify a goal create/update for invalidation blast radius.
 * Create and any funding/forecast-impacting field → "funding"; else "metadata".
 */
export function classifyGoalSaveImpact(
  editing: FinancialGoal | null,
  values: GoalSaveImpactInput,
  previousFunding?: GoalFundingFormState
): "metadata" | "funding" {
  if (editing == null) {
    // Create: debt has no auto-fund rules; savings create always configures funding.
    return values.goal_type === "debt_payoff" ? "metadata" : "funding";
  }

  const isDebt = values.goal_type === "debt_payoff";
  const prevMonthly = editing.monthly_contribution ?? editing.monthly_target ?? "0";
  const prevLinked = isDebt
    ? editing.linked_credit_account ?? editing.linked_account ?? ""
    : editing.linked_account ?? "";
  const nextLinked = isDebt ? values.linked_credit_account : values.linked_account;

  if (normMoney(values.target_amount) !== normMoney(editing.target_amount)) return "funding";
  if (normMoney(values.monthly_contribution) !== normMoney(prevMonthly)) return "funding";
  if (values.include_in_safe_to_spend !== (editing.include_in_safe_to_spend ?? true)) {
    return "funding";
  }
  if (values.forecast_enabled !== (editing.forecast_enabled ?? true)) return "funding";
  if (values.auto_fund_enabled !== (editing.auto_fund_enabled ?? false)) return "funding";
  if (String(nextLinked || "") !== String(prevLinked || "")) return "funding";
  if (values.goal_type !== editing.goal_type) return "funding";
  if (!isDebt && fundingStateChanged(previousFunding, values.funding)) return "funding";

  return "metadata";
}

export function invalidateAfterGoalSave(
  queryClient: QueryClient,
  impact: "metadata" | "funding",
  options?: { isDebt?: boolean }
): void {
  if (impact === "funding") {
    invalidateGoalFundingQueries(queryClient);
    return;
  }
  // Debt metadata still touches forecast (linked balance / safe-to-spend).
  invalidateGoalMetadataQueries(queryClient);
  if (options?.isDebt) {
    invalidateForecastQueries(queryClient);
  }
}
