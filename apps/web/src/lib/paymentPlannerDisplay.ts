import { formatCurrency } from "@budget-app/shared";
import type { Account, DebtPayoffCardSummary, PayoffProjection, PayoffStrategy } from "@budget-app/shared";

/** Primary CTA label for debt payment orchestration (replaces "Make Payment"). */
export const PAYMENT_PLANNER_LABEL = "Payment Planner";

/** @deprecated Use PAYMENT_PLANNER_LABEL */
export const OPEN_PAYOFF_PLANNER_LABEL = PAYMENT_PLANNER_LABEL;

export type PaymentPlanOptionId =
  | "minimum_payment"
  | "statement_balance"
  | "target_utilization"
  | "custom_amount";

export const PHASE1_PAYMENT_PLAN_OPTIONS: Array<{
  id: PaymentPlanOptionId;
  label: string;
  description?: string;
}> = [
  { id: "minimum_payment", label: "Minimum payment" },
  { id: "statement_balance", label: "Statement balance" },
  { id: "target_utilization", label: "Target utilization" },
  { id: "custom_amount", label: "Custom amount" },
];

export function normalizePaymentActionLabel(label: string | null | undefined): string {
  if (!label?.trim()) return PAYMENT_PLANNER_LABEL;
  const trimmed = label.trim();
  if (/^make\s*payment$/i.test(trimmed)) return PAYMENT_PLANNER_LABEL;
  if (/^(open\s*)?payoff\s*planner$/i.test(trimmed)) return PAYMENT_PLANNER_LABEL;
  if (/^pay\s*credit\s*card$/i.test(trimmed)) return PAYMENT_PLANNER_LABEL;
  if (/^debt\s*payoff$/i.test(trimmed)) return PAYMENT_PLANNER_LABEL;
  return label;
}

function parseMoney(raw: string | null | undefined): number | null {
  if (raw == null || String(raw).trim() === "") return null;
  const n = parseFloat(String(raw).replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : null;
}

export function balanceOwed(account: Account): number | null {
  const owed = parseMoney(account.balance_owed ?? account.current_balance);
  if (owed != null && owed > 0) return owed;
  const bal = parseMoney(account.balance);
  if (bal != null && bal < 0) return Math.abs(bal);
  return owed;
}

export function creditLimitAmount(account: Account): number | null {
  return parseMoney(account.credit_limit);
}

/** Payment to bring utilization to target % (matches backend calculators). */
export function paymentToReachUtilization(
  account: Account,
  targetPct?: number
): number | null {
  const limit = creditLimitAmount(account);
  const owed = balanceOwed(account);
  if (limit == null || limit <= 0 || owed == null) return null;
  const target =
    targetPct ??
    parseMoney(account.target_utilization_percent ?? "70") ??
    70;
  const targetBalance = (target / 100) * limit;
  const needed = owed - targetBalance;
  return needed > 0 ? Math.round(needed * 100) / 100 : 0;
}

export function targetUtilizationPercent(account: Account): number {
  const raw = parseMoney(account.target_utilization_percent ?? "70");
  return raw != null && raw > 0 ? raw : 70;
}

export function isCreditCardAccount(account: Account): boolean {
  return account.account_type === "CREDIT";
}

export function isDebtPaymentAccount(account: Account): boolean {
  return account.account_type === "CREDIT" || account.account_type === "LOAN";
}

export function isHighestAprAmongCards(card: Account, allAccounts: Account[]): boolean {
  if (!isCreditCardAccount(card)) return false;
  const cardApr = parseMoney(card.apr);
  if (cardApr == null) return false;
  let maxApr = cardApr;
  for (const a of allAccounts) {
    if (!isCreditCardAccount(a)) continue;
    const apr = parseMoney(a.apr);
    if (apr != null && apr > maxApr) maxApr = apr;
  }
  return cardApr >= maxApr;
}

export function avalancheInsightLine(card: Account, allAccounts: Account[]): string | null {
  if (!isHighestAprAmongCards(card, allAccounts)) return null;
  return "Highest APR debt — paying this first reduces total interest fastest.";
}

export function payoffEstimateSubtitle(account: Account): string | null {
  const est = account.payoff_estimate;
  if (!est || est.payoff_possible === false) return null;
  const months = est.months_to_payoff;
  const payment = est.payment_amount;
  if (months != null && months > 0 && payment) {
    const payFmt = formatCurrency(payment);
    const monthLabel = `${months} month${months === 1 ? "" : "s"}`;
    return `Paying ${payFmt}/mo pays off in ${monthLabel}`;
  }
  return est.label ?? null;
}

export function estimatedInterestSubtitle(account: Account): string | null {
  const raw =
    account.estimated_monthly_interest ?? account.projected_interest_if_unpaid ?? null;
  if (!raw) return null;
  return `Estimated interest this month: ${formatCurrency(raw)}`;
}

export function utilizationTargetSubtitle(account: Account): string | null {
  const util = utilizationPercent(account);
  const target = targetUtilizationPercent(account);
  if (util == null || util <= target) return null;
  return `Reduce utilization below ${target}%`;
}

export function targetUtilizationPlanHint(account: Account): string | null {
  const target = targetUtilizationPercent(account);
  const pay = paymentToReachUtilization(account, target);
  if (pay == null || pay <= 0) return null;
  return `Pay ${formatCurrency(String(pay))} to reach ${target}% utilization`;
}

export function buildPaymentPlannerSubtitles(
  card: Account,
  allAccounts: Account[]
): string[] {
  const lines: string[] = [];
  const utilLine = utilizationTargetSubtitle(card);
  if (utilLine) lines.push(utilLine);
  const interestLine = estimatedInterestSubtitle(card);
  if (interestLine) lines.push(interestLine);
  const payoffLine = payoffEstimateSubtitle(card);
  if (payoffLine) lines.push(payoffLine);
  const avalanche = avalancheInsightLine(card, allAccounts);
  if (avalanche) lines.push(avalanche);
  return lines;
}

export function amountForPaymentPlanOption(
  account: Account,
  option: PaymentPlanOptionId
): string {
  if (option === "minimum_payment") {
    return defaultPaymentAmountForStrategy(account, "minimum_payment");
  }
  if (option === "statement_balance") {
    return defaultPaymentAmountForStrategy(account, "statement_balance");
  }
  if (option === "target_utilization") {
    const pay = paymentToReachUtilization(account);
    return pay != null && pay > 0 ? String(pay) : "";
  }
  return "";
}

export function paymentPlanOptionsForAccount(account: Account): typeof PHASE1_PAYMENT_PLAN_OPTIONS {
  if (!isCreditCardAccount(account)) {
    return PHASE1_PAYMENT_PLAN_OPTIONS.filter((o) => o.id !== "target_utilization");
  }
  return PHASE1_PAYMENT_PLAN_OPTIONS;
}

export const PAYOFF_STRATEGY_OPTIONS: Array<{
  id: PayoffStrategy;
  label: string;
  description: string;
}> = [
  { id: "minimum_payment", label: "Pay minimum", description: "Minimum payment each month" },
  { id: "statement_balance", label: "Pay statement", description: "Last statement balance" },
  { id: "current_balance", label: "Pay current balance", description: "One-time full payoff" },
  { id: "fixed_amount", label: "Fixed amount", description: "Same payment every month" },
  { id: "custom_amount", label: "Custom amount", description: "Enter your monthly payment" },
];

/** Payment strategies shown in the debt strategy drawer (monthly payment scenarios). */
export const DRAWER_PAYOFF_STRATEGY_OPTIONS: Array<{
  id: PayoffStrategy;
  label: string;
  description: string;
}> = [
  { id: "minimum_payment", label: "Minimum", description: "Minimum payment each month" },
  { id: "custom_amount", label: "Custom amount", description: "Enter your monthly payment" },
];

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
  if (strategy === "statement_balance") {
    return (
      positiveMoney(account.statement_balance) ??
      positiveMoney(account.payoff_to_avoid_interest) ??
      positiveMoney(planCard.suggested_payment) ??
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
  if (strategy === "statement_balance") {
    const stmt = drawerPaymentAmountDisplay(account, planCard, strategy, amountInput);
    if (stmt && Number(stmt) > 0) {
      return { monthly_payment: stmt };
    }
    return { strategy: "statement_balance" };
  }
  return { strategy };
}

export function strategyRequiresAmountInput(strategy: PayoffStrategy): boolean {
  return strategy === "fixed_amount" || strategy === "custom_amount";
}

export function defaultPaymentAmountForStrategy(account: Account, strategy: PayoffStrategy): string {
  if (strategy === "minimum_payment") {
    return account.minimum_payment_amount ?? "";
  }
  if (strategy === "statement_balance") {
    const stmt = account.statement_balance ?? account.payoff_to_avoid_interest ?? "";
    if (stmt && parseMoney(stmt) !== 0) return stmt;
    const owed = balanceOwed(account);
    return owed != null && owed > 0 ? String(owed) : stmt;
  }
  if (strategy === "current_balance") {
    return account.balance_owed ?? account.current_balance ?? "";
  }
  return "";
}

export function payoffSummaryLine(projection: PayoffProjection | null | undefined): string | null {
  if (!projection) return null;
  if (!projection.payoff_possible) {
    return projection.message ?? "Payment is too low to reduce balance.";
  }
  if (projection.months_to_payoff <= 0) {
    return "Already paid off";
  }
  const months = projection.months_to_payoff;
  const payment = projection.payment_amount;
  const date = projection.payoff_date;
  const monthLabel = `${months} month${months === 1 ? "" : "s"}`;
  if (date) {
    return `Paid off in ${monthLabel} at $${payment}/mo · ${date}`;
  }
  return `Paid off in ${monthLabel} at $${payment}/mo`;
}

export function payoffImpossibleWarning(projection: PayoffProjection | null | undefined): string | null {
  if (!projection || projection.payoff_possible !== false) return null;
  return projection.message ?? "Payment is too low to reduce balance.";
}

export function utilizationPercent(account: Account): number | null {
  const raw = account.utilization_percent;
  if (raw == null || String(raw).trim() === "") return null;
  const n = parseFloat(String(raw));
  return Number.isFinite(n) ? n : null;
}
