import type { DebtPayoffMode, DebtPayoffPlan } from "./types";
import { formatMonthYear } from "./dateDisplay";
import { formatCurrency } from "./utils";

/** Primary CTA label for debt payment orchestration. */
export const PAYMENT_PLANNER_LABEL = "Payment Planner";

export function normalizePaymentActionLabel(label: string | null | undefined): string {
  if (!label?.trim()) return PAYMENT_PLANNER_LABEL;
  const trimmed = label.trim();
  if (/^make\s*payment$/i.test(trimmed)) return PAYMENT_PLANNER_LABEL;
  if (/^(open\s*)?payoff\s*planner$/i.test(trimmed)) return PAYMENT_PLANNER_LABEL;
  if (/^pay\s*credit\s*card$/i.test(trimmed)) return PAYMENT_PLANNER_LABEL;
  if (/^debt\s*payoff$/i.test(trimmed)) return PAYMENT_PLANNER_LABEL;
  return label;
}

/** Summary-tile copy for Payment Planner (web + mobile). */
export const PLANNER_SUMMARY_METRICS = {
  totalDebt: {
    label: "Total debt",
    help: "Current balances on all credit cards in this plan.",
  },
  weightedApr: {
    label: "Weighted APR",
    help: "Average interest rate across your cards, weighted by balance. A larger balance counts more than a smaller one.",
  },
  interestThisMonth: {
    label: "Interest this month",
    help: "Estimated interest all your cards will charge this month at current balances.",
  },
  debtFree: {
    label: "Debt-free",
    help: "Projected month all credit-card debt is paid off under this plan.",
  },
} as const;

export type DebtFreeSummary = {
  value: string;
  subtitle: string | null;
};

function parsePlannerMoney(raw: string | number | null | undefined): number {
  if (raw == null || String(raw).trim() === "") return 0;
  const n = typeof raw === "number" ? raw : parseFloat(String(raw).replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

/** Extra monthly is ignored when payoff mode is survival (minimums only). */
export function extraMonthlyApplies(mode: DebtPayoffMode): boolean {
  return mode !== "survival";
}

/**
 * How much extra per month is needed just to cover interest that minimums miss.
 * Zero when every card's minimum already covers its monthly interest.
 */
export function interestCoverageGap(plan: Pick<DebtPayoffPlan, "cards">): number {
  let gap = 0;
  for (const card of plan.cards ?? []) {
    const interest = parsePlannerMoney(card.interest_this_month);
    const min = parsePlannerMoney(card.minimum_payment);
    gap += Math.max(0, interest - min);
  }
  return Math.round(gap * 100) / 100;
}

/** Hero Debt-free tile: a date when modeled, otherwise an actionable gap — never "Needs higher pay". */
export function debtFreeSummary(plan: DebtPayoffPlan): DebtFreeSummary {
  if (parsePlannerMoney(plan.total_debt) <= 0) {
    return { value: "Paid off", subtitle: null };
  }
  if (plan.debt_free_date) {
    const when = formatMonthYear(plan.debt_free_date) ?? plan.debt_free_date;
    const months = plan.months_to_debt_free;
    const subtitle =
      months != null && months > 0
        ? `${months} month${months === 1 ? "" : "s"} on this plan`
        : null;
    return { value: when, subtitle };
  }
  const gap = interestCoverageGap(plan);
  if (gap > 0.5) {
    return {
      value: "No date yet",
      subtitle: `Need about ${formatCurrency(gap)}/mo more just to cover interest`,
    };
  }
  return {
    value: "No date yet",
    subtitle: "Add extra per month to see a payoff date",
  };
}

export function debtFreePlanMessage(plan: DebtPayoffPlan): string {
  if (parsePlannerMoney(plan.total_debt) <= 0) return "You're credit card debt free.";
  if (plan.debt_free_date) {
    const when = formatMonthYear(plan.debt_free_date) ?? plan.debt_free_date;
    return `Debt-free by ${when}`;
  }
  const gap = interestCoverageGap(plan);
  if (gap > 0.5) {
    return `Minimums leave about ${formatCurrency(gap)}/mo of interest unpaid.`;
  }
  return "Add extra per month to see a payoff date.";
}

/** Shown when extra is $0 so avalanche vs snowball appears to do nothing. */
export function strategyNeedsExtraHint(extraMonthly: string | null | undefined): string | null {
  if (parsePlannerMoney(extraMonthly) > 0) return null;
  return "Strategy decides which card gets extra. With $0 extra, avalanche and snowball look the same.";
}

export function survivalIgnoresExtraHint(mode: DebtPayoffMode, extraMonthly: string | null | undefined): boolean {
  return mode === "survival" && parsePlannerMoney(extraMonthly) > 0;
}
