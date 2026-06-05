import type { DebtPayoffCardSummary, DebtPayoffPlan, PayoffProjection } from "@budget-app/shared";
import { formatCurrency } from "@budget-app/shared";
import { formatDateDisplay } from "../components/transactions/transactionsLedgerUtils";

function parseMoney(raw: string | null | undefined): number {
  if (raw == null || String(raw).trim() === "") return 0;
  const n = parseFloat(String(raw).replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

export type DebtCardOutcomeLines = {
  headline: string;
  suggestedLine: string;
  interestLine: string | null;
};

/** Emphasis lines for debt grid cards (portfolio plan context). */
export function debtCardOutcomeLines(card: DebtPayoffCardSummary): DebtCardOutcomeLines {
  const suggested = formatCurrency(card.suggested_payment);
  const suggestedLine = `Suggested payoff: ${suggested}/mo`;

  if (card.months_remaining != null && card.months_remaining > 0) {
    const months = card.months_remaining;
    const monthLabel = `${months} month${months === 1 ? "" : "s"}`;
    const headline = `Debt-free in ${monthLabel}`;
    const interestLine = card.total_projected_interest
      ? `${formatCurrency(card.total_projected_interest)} projected interest`
      : null;
    return { headline, suggestedLine, interestLine };
  }

  if (card.payoff_date) {
    return {
      headline: `Debt-free by ${formatDateDisplay(card.payoff_date)}`,
      suggestedLine,
      interestLine: card.total_projected_interest
        ? `${formatCurrency(card.total_projected_interest)} projected interest`
        : null,
    };
  }

  return {
    headline: "Increase payment to model payoff",
    suggestedLine,
    interestLine: null,
  };
}

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

/** Portfolio-aware impact copy for the debt strategy drawer. */
export function portfolioImpactMessage(
  plan: DebtPayoffPlan | null | undefined,
  planCard: DebtPayoffCardSummary | undefined,
  projection: PayoffProjection | null | undefined
): string | null {
  const monthsSaved = monthsSavedOnCard(planCard, projection);
  if (!monthsSaved || !plan || !planCard) return null;

  const isPriority = planCard.payoff_order === 1;
  if (isPriority && plan.months_to_debt_free != null && plan.months_to_debt_free > 0) {
    const capped = Math.min(monthsSaved, plan.months_to_debt_free);
    if (capped > 0) {
      return `This payment may improve your overall debt-free date by up to ${capped} month${capped === 1 ? "" : "s"}.`;
    }
  }

  return `Clears this card ${monthsSaved} month${monthsSaved === 1 ? "" : "s"} faster than the current strategy suggestion.`;
}

export type DrawerForecastRow = {
  label: string;
  value: string;
  accent?: "positive" | "warning";
};

export function drawerPayoffImpossibleMessage(
  planCard: DebtPayoffCardSummary,
  projection: PayoffProjection
): string {
  const payment = parseMoney(projection.payment_amount);
  const interest = parseMoney(planCard.interest_this_month);
  if (payment > 0 && interest > 0 && payment <= interest) {
    return `At ${formatCurrency(projection.payment_amount)}/mo, payments don't cover ~${formatCurrency(planCard.interest_this_month)}/mo in interest. Pay above ${formatCurrency(planCard.interest_this_month)}/mo to shrink this balance.`;
  }
  return projection.message ?? "Payment is too low to reduce balance.";
}

function timelineLabel(projection: PayoffProjection): string {
  if (!projection.payoff_possible) {
    const payment = parseMoney(projection.payment_amount);
    if (payment <= 0) return "—";
    return "Won't shrink";
  }
  if (projection.months_to_payoff <= 0) return "Paid off";
  return `${projection.months_to_payoff} mo`;
}

/** Aligned forecast rows for the debt strategy drawer. */
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
      value: projection.payoff_possible && projection.payoff_date
        ? formatDateDisplay(projection.payoff_date)
        : "—",
    },
    {
      label: "Timeline",
      value: timelineLabel(projection),
      accent: !projection.payoff_possible ? "warning" : undefined,
    },
    {
      label: "Total interest",
      value:
        projection.payoff_possible && projection.total_interest
          ? formatCurrency(projection.total_interest)
          : "—",
    },
    {
      label: "Payment",
      value: payment,
    },
  ];

  if (projection.payoff_possible && planCard) {
    const monthsSaved = monthsSavedOnCard(planCard, projection);
    const interestSaved = interestSavedOnCard(planCard, projection);
    if (monthsSaved != null || interestSaved != null) {
      const parts: string[] = [];
      if (monthsSaved != null) {
        parts.push(`${monthsSaved} mo faster vs plan`);
      }
      if (interestSaved != null) {
        parts.push(`save ${formatCurrency(String(interestSaved))}`);
      }
      rows.push({
        label: "vs plan",
        value: parts.join(" · "),
        accent: "positive",
      });
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

export type DrawerForecastMetrics = {
  payoffDate: string | null;
  monthsToPayoff: number | null;
  totalInterest: string | null;
  paymentAmount: string | null;
  monthsSaved: number | null;
  interestSaved: number | null;
  portfolioImpact: string | null;
};

export function drawerForecastMetrics(
  projection: PayoffProjection | null | undefined,
  planCard: DebtPayoffCardSummary | undefined,
  plan: DebtPayoffPlan | null | undefined
): DrawerForecastMetrics | null {
  if (!projection) return null;
  if (!projection.payoff_possible) {
    return {
      payoffDate: null,
      monthsToPayoff: null,
      totalInterest: null,
      paymentAmount: projection.payment_amount ?? null,
      monthsSaved: null,
      interestSaved: null,
      portfolioImpact: null,
    };
  }

  return {
    payoffDate: projection.payoff_date,
    monthsToPayoff: projection.months_to_payoff,
    totalInterest: projection.total_interest,
    paymentAmount: projection.payment_amount,
    monthsSaved: monthsSavedOnCard(planCard, projection),
    interestSaved: interestSavedOnCard(planCard, projection),
    portfolioImpact: portfolioImpactMessage(plan, planCard, projection),
  };
}
