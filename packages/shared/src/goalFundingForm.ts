import type { RecurringRule } from "./types";
import { formatCurrency } from "./utils";

export type GoalFundingAmountMode = "fixed" | "percent";

export type GoalFundingFormState = {
  enabled: boolean;
  incomeRuleId: number | "";
  amountMode: GoalFundingAmountMode;
  fixedAmount: string;
  percent: string;
};

export const emptyGoalFundingForm: GoalFundingFormState = {
  enabled: false,
  incomeRuleId: "",
  amountMode: "fixed",
  fixedAmount: "",
  percent: "",
};

export function incomeRulesForFunding(rules: RecurringRule[]): RecurringRule[] {
  return rules.filter((r) => r.active !== false && r.direction === "INCOME");
}

export function formatIncomeRuleOption(rule: RecurringRule): string {
  const amt = formatCurrency(String(rule.amount), rule.currency ?? "USD");
  return `${rule.name} (${amt})`;
}

function paycheckPeriodLabel(frequency: string): string {
  if (frequency === "WEEKLY") return "week";
  if (frequency === "BIWEEKLY") return "paycheck";
  if (frequency === "YEARLY") return "year";
  return "month";
}

export function estimatePaycheckContributionLabel(
  funding: GoalFundingFormState,
  monthlyContribution: string,
  rules: RecurringRule[]
): string | null {
  if (!funding.enabled || !funding.incomeRuleId) return null;
  const rule = rules.find((r) => r.id === funding.incomeRuleId);
  if (!rule) return null;
  const period = paycheckPeriodLabel(rule.frequency);
  const currency = rule.currency ?? "USD";

  if (funding.amountMode === "percent") {
    const pct = parseFloat(funding.percent);
    const base = parseFloat(String(rule.amount));
    if (!Number.isFinite(pct) || pct <= 0 || !Number.isFinite(base) || base <= 0) return null;
    return `${formatCurrency(((base * pct) / 100).toFixed(2), currency)} per ${period}`;
  }

  const raw = funding.fixedAmount.trim() || monthlyContribution.trim();
  const amount = parseFloat(raw);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return `${formatCurrency(raw, currency)} per ${period}`;
}

export function goalFundingFormFromAllocation(
  autoFundEnabled: boolean,
  allocation: {
    rule: number;
    fixed_amount: string | null;
    percent: string | null;
  } | null | undefined,
  monthlyTarget?: string | null
): GoalFundingFormState {
  if (!allocation) {
    return {
      ...emptyGoalFundingForm,
      enabled: autoFundEnabled,
      fixedAmount: monthlyTarget && parseFloat(monthlyTarget) > 0 ? monthlyTarget : "",
    };
  }
  const hasPercent = allocation.percent != null && parseFloat(allocation.percent) > 0;
  return {
    enabled: autoFundEnabled,
    incomeRuleId: allocation.rule,
    amountMode: hasPercent ? "percent" : "fixed",
    fixedAmount: allocation.fixed_amount ?? "",
    percent: allocation.percent ?? "",
  };
}

export function buildBucketFundingPayload(
  funding: GoalFundingFormState,
  monthlyTarget: string
): {
  auto_fund_enabled: boolean;
  income_rule_id?: number;
  fixed_amount?: string;
  percent?: string;
  clear_allocation?: boolean;
} {
  if (!funding.enabled) {
    return { auto_fund_enabled: false, clear_allocation: true };
  }

  if (!funding.incomeRuleId) {
    return { auto_fund_enabled: true };
  }

  if (funding.amountMode === "fixed") {
    const amt = funding.fixedAmount.trim() || monthlyTarget.trim();
    if (!amt || parseFloat(amt) <= 0) {
      throw new Error("Enter a positive transfer amount per paycheck.");
    }
    return {
      auto_fund_enabled: true,
      income_rule_id: Number(funding.incomeRuleId),
      fixed_amount: amt,
    };
  }

  const pct = funding.percent.trim();
  if (!pct || parseFloat(pct) <= 0) {
    throw new Error("Enter a percent between 1 and 100.");
  }
  return {
    auto_fund_enabled: true,
    income_rule_id: Number(funding.incomeRuleId),
    percent: pct,
  };
}

export function validateGoalFundingForm(
  funding: GoalFundingFormState,
  monthlyTarget: string
): string | null {
  if (!funding.enabled) return null;
  if (!funding.incomeRuleId) {
    return "Select a paycheck or income rule to auto-fund this goal.";
  }
  if (funding.amountMode === "fixed") {
    const amt = funding.fixedAmount.trim() || monthlyTarget.trim();
    if (!amt || parseFloat(amt) <= 0) {
      return "Enter a positive transfer amount per paycheck.";
    }
    return null;
  }
  const pct = parseFloat(funding.percent);
  if (!Number.isFinite(pct) || pct <= 0 || pct > 100) {
    return "Enter a percent between 1 and 100.";
  }
  return null;
}
