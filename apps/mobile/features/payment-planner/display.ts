import {
  DEFAULT_TARGET_UTILIZATION_PERCENT,
  formatCurrency,
  type Account,
  type DebtPayoffCardSummary,
  type DebtPayoffMode,
  type DebtPayoffPlan,
  type DebtPayoffStrategy,
  type PayoffProjection,
  type PayoffStrategy,
} from "@budget-app/shared";
import { formatDateDisplay } from "@/lib/dates";

/** Prefer explicit Apply over per-keystroke refetch. Kept for scenario drawer debounce. */
export const WHAT_IF_NUMERIC_DEBOUNCE_MS = 400;

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

export const DRAWER_PAYOFF_STRATEGY_OPTIONS: Array<{
  id: PayoffStrategy;
  label: string;
  description: string;
}> = [
  { id: "minimum_payment", label: "Minimum", description: "Minimum payment each month" },
  { id: "custom_amount", label: "Custom amount", description: "Enter your monthly payment" },
];

function parseMoney(raw: string | null | undefined): number {
  if (raw == null || String(raw).trim() === "") return 0;
  const n = parseFloat(String(raw).replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

/** Format API money for UI; never render NaN. */
export function formatMoneyOrDash(raw: string | number | null | undefined): string {
  if (raw == null || String(raw).trim() === "") return "—";
  const n = typeof raw === "number" ? raw : parseFloat(String(raw).replace(/[^\d.-]/g, ""));
  if (!Number.isFinite(n)) return "—";
  return formatCurrency(raw);
}

export function formatDebtFreeMonth(plan: DebtPayoffPlan): string {
  if (parseMoney(plan.total_debt) <= 0) return "Paid off";
  if (plan.debt_free_date) {
    const d = new Date(`${plan.debt_free_date.slice(0, 10)}T12:00:00`);
    if (!Number.isNaN(d.getTime())) {
      return d.toLocaleDateString(undefined, { month: "short", year: "numeric" });
    }
    return formatDateDisplay(plan.debt_free_date);
  }
  if (plan.simulation_status === "non_amortizing" || !plan.debt_free_possible) {
    return "—";
  }
  return "—";
}

export function isCreditCardAccount(account: Account): boolean {
  return account.account_type === "CREDIT";
}

export function debtStrategyLabel(strategy: DebtPayoffStrategy): string {
  return DEBT_STRATEGY_OPTIONS.find((o) => o.id === strategy)?.label ?? strategy;
}

export function debtStrategyDescription(strategy: DebtPayoffStrategy): string {
  return DEBT_STRATEGY_OPTIONS.find((o) => o.id === strategy)?.description ?? "";
}

export function debtModeLabel(mode: DebtPayoffMode): string {
  return DEBT_MODE_OPTIONS.find((o) => o.id === mode)?.label ?? mode;
}

export function debtModeDescription(mode: DebtPayoffMode): string {
  return DEBT_MODE_OPTIONS.find((o) => o.id === mode)?.description ?? "";
}

export function parseDebtModeParam(raw: string | null | undefined): DebtPayoffMode | null {
  if (raw === "survival" || raw === "aggressive" || raw === "credit_score" || raw === "balanced") {
    return raw;
  }
  return null;
}

export function debtFreeHeadline(plan: DebtPayoffPlan | null | undefined): string {
  if (!plan) return "";
  if (parseMoney(plan.total_debt) <= 0) return "You're credit card debt free.";
  if (!plan.debt_free_possible) return "Increase payments to reach a payoff date.";
  if (plan.debt_free_date) {
    return `Debt-free by ${formatDateDisplay(plan.debt_free_date)} (projected)`;
  }
  return "";
}

export function interestSavedLine(plan: DebtPayoffPlan): string | null {
  if (plan.baseline_status === "baseline_not_payoffable") return null;
  if (plan.interest_saved_vs_minimums == null) return null;
  const saved = parseMoney(plan.interest_saved_vs_minimums);
  if (saved <= 0) return null;
  return `Projected interest savings: ${formatMoneyOrDash(plan.interest_saved_vs_minimums)}`;
}

export function baselineNotPayoffableLine(plan: DebtPayoffPlan): string | null {
  if (plan.baseline_status !== "baseline_not_payoffable") return null;
  return "Minimum payments alone would not pay off all debts.";
}

export type DebtCardOutcomeLines = {
  headline: string;
  suggestedLine: string;
  interestLine: string | null;
};

export function debtCardOutcomeLines(card: DebtPayoffCardSummary): DebtCardOutcomeLines {
  const suggestedLine = `Min ${formatMoneyOrDash(card.minimum_payment)}`;

  if (card.payoff_status === "non_amortizing") {
    return {
      headline: "Payment too low for modeled payoff",
      suggestedLine,
      interestLine: null,
    };
  }

  if (card.months_remaining === 1) {
    return {
      headline: "Payoff next payment",
      suggestedLine,
      interestLine: null,
    };
  }

  if (card.months_remaining != null && card.months_remaining > 0) {
    const months = card.months_remaining;
    return {
      headline: `Projected ${months} month${months === 1 ? "" : "s"}`,
      suggestedLine,
      interestLine: null,
    };
  }

  if (card.payoff_date) {
    return {
      headline: `Projected payoff by ${formatDateDisplay(card.payoff_date)}`,
      suggestedLine,
      interestLine: null,
    };
  }

  return {
    headline: "Not enough data to project",
    suggestedLine,
    interestLine: null,
  };
}

/** Compact secondary line for payoff list rows. */
export function debtRowMetaLine(card: DebtPayoffCardSummary): string {
  const apr = parseMoney(card.apr);
  const aprPart = Number.isFinite(apr) ? `${card.apr}% APR` : "APR —";
  return `${aprPart} · Min ${formatMoneyOrDash(card.minimum_payment)}`;
}

export function priorityReasonLabel(card: DebtPayoffCardSummary): string | null {
  return card.priority_reason?.label ?? null;
}

export function drawerStrategyRequiresAmountInput(strategy: PayoffStrategy): boolean {
  return strategy === "custom_amount";
}

function positiveMoney(raw: string | null | undefined): string | null {
  if (raw == null || String(raw).trim() === "") return null;
  const n = parseFloat(String(raw).replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) && n > 0 ? String(raw).trim() : null;
}

export function drawerPaymentAmountDisplay(
  account: Account,
  planCard: DebtPayoffCardSummary,
  strategy: PayoffStrategy,
  amountInput: string
): string {
  if (strategy === "custom_amount") return amountInput;
  if (strategy === "minimum_payment") {
    return (
      positiveMoney(account.minimum_payment_amount) ??
      positiveMoney(planCard.minimum_payment) ??
      ""
    );
  }
  return "";
}

export function buildDrawerPayoffParams(
  account: Account,
  planCard: DebtPayoffCardSummary,
  strategy: PayoffStrategy,
  amountInput: string
): { strategy: PayoffStrategy; custom_amount?: string } | { monthly_payment: string } {
  if (strategy === "custom_amount") {
    return { strategy, custom_amount: amountInput.trim() };
  }
  if (strategy === "minimum_payment") {
    const min = drawerPaymentAmountDisplay(account, planCard, strategy, amountInput);
    if (min && Number(min) > 0) {
      return { monthly_payment: min };
    }
    return { strategy: "minimum_payment" };
  }
  return { strategy };
}

export function targetUtilizationPercent(account: Account): number {
  const raw = parseMoney(account.target_utilization_percent);
  return raw >= 0 ? raw : DEFAULT_TARGET_UTILIZATION_PERCENT;
}

/** Payment to bring utilization to target % (matches backend calculators). */
export function paymentToReachUtilization(account: Account, targetPct?: number): number | null {
  const limit = parseMoney(account.credit_limit);
  const owed = parseMoney(account.balance_owed ?? account.current_balance ?? account.balance);
  if (limit <= 0 || owed <= 0) return null;
  const target = targetPct ?? targetUtilizationPercent(account);
  const targetBalance = (target / 100) * limit;
  const needed = owed - targetBalance;
  return needed > 0 ? Math.round(needed * 100) / 100 : 0;
}

export function targetUtilizationPlanHint(account: Account): string | null {
  const target = targetUtilizationPercent(account);
  const pay = paymentToReachUtilization(account, target);
  if (pay == null || pay <= 0) return null;
  return `Pay ${formatCurrency(String(pay))} to reach ${target}% utilization target`;
}

export type DrawerForecastRow = {
  label: string;
  value: string;
  accent?: "positive" | "warning";
};

export function monthsSavedOnCard(
  planCard: DebtPayoffCardSummary | undefined,
  projection: PayoffProjection | null | undefined
): number | null {
  if (!planCard?.months_remaining || !projection?.payoff_possible) return null;
  const saved = planCard.months_remaining - projection.months_to_payoff;
  return saved > 0 ? saved : null;
}

export function interestSavedOnCard(
  planCard: DebtPayoffCardSummary | undefined,
  projection: PayoffProjection | null | undefined
): number | null {
  if (!planCard?.total_projected_interest || !projection?.payoff_possible) return null;
  const planInterest = parseMoney(planCard.total_projected_interest);
  const scenarioInterest = parseMoney(projection.total_interest);
  const saved = planInterest - scenarioInterest;
  return saved > 0.01 ? Math.round(saved * 100) / 100 : null;
}

export function drawerForecastRows(
  projection: PayoffProjection | null | undefined,
  planCard: DebtPayoffCardSummary | undefined,
  plan: DebtPayoffPlan | null | undefined,
  resolvedPayment?: string
): DrawerForecastRow[] {
  if (!projection) return [];

  const paymentAmount =
    parseMoney(projection.payment_amount) > 0 ? projection.payment_amount : resolvedPayment;
  const payment =
    paymentAmount && parseMoney(paymentAmount) > 0
      ? `${formatCurrency(paymentAmount)}/mo`
      : "—";

  const rows: DrawerForecastRow[] = [
    {
      label: "Payoff date",
      value:
        projection.payoff_possible && projection.payoff_date
          ? formatDateDisplay(projection.payoff_date)
          : "—",
    },
    {
      label: "Timeline",
      value: !projection.payoff_possible
        ? "Won't shrink"
        : projection.months_to_payoff <= 0
          ? "Paid off"
          : `${projection.months_to_payoff} mo`,
      accent: !projection.payoff_possible ? "warning" : undefined,
    },
    {
      label: "Total interest",
      value:
        projection.payoff_possible && projection.total_interest
          ? formatCurrency(projection.total_interest)
          : "—",
    },
    { label: "Payment", value: payment },
  ];

  if (projection.payoff_possible && planCard) {
    const monthsSaved = monthsSavedOnCard(planCard, projection);
    const interestSaved = interestSavedOnCard(planCard, projection);
    if (monthsSaved != null || interestSaved != null) {
      const parts: string[] = [];
      if (monthsSaved != null) parts.push(`${monthsSaved} mo faster vs plan`);
      if (interestSaved != null) parts.push(`save ${formatCurrency(String(interestSaved))}`);
      rows.push({ label: "vs plan", value: parts.join(" · "), accent: "positive" });
    }
  }

  if (projection.payoff_possible && plan?.debt_free_date && planCard?.payoff_order === 1) {
    rows.push({
      label: "Household",
      value: `Debt-free ${formatDateDisplay(plan.debt_free_date)} (${plan.months_to_debt_free ?? "—"} mo)`,
    });
  }

  return rows;
}

export function drawerPayoffImpossibleMessage(
  planCard: DebtPayoffCardSummary,
  projection: PayoffProjection
): string {
  const payment = parseMoney(projection.payment_amount);
  const interest = parseMoney(planCard.interest_this_month);
  if (payment > 0 && interest > 0 && payment <= interest) {
    return `At ${formatCurrency(projection.payment_amount)}/mo, payments don't cover ~${formatCurrency(planCard.interest_this_month)}/mo in interest.`;
  }
  return projection.message ?? "Planned payment may not be enough to reduce the balance.";
}

export function topRecommendation(plan: DebtPayoffPlan): string | null {
  const high = plan.recommendations.find((r) => r.priority === "high");
  return high?.message ?? plan.recommendations[0]?.message ?? null;
}

export function planIsRecalculating(
  inputs: { extraMonthly: string; lumpSum: string },
  debounced: { extraMonthly: string; lumpSum: string },
  isFetching: boolean
): boolean {
  return (
    isFetching &&
    (inputs.extraMonthly !== debounced.extraMonthly || inputs.lumpSum !== debounced.lumpSum)
  );
}
