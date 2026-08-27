import type { FinancialGoalType } from "@budget-app/shared";
import {
  buildBucketFundingPayload,
  goalTypeToBucketType,
  priorityToBucketPriority,
  type GoalFundingFormState,
} from "@budget-app/shared";

export type GoalFormValues = {
  name: string;
  description: string;
  goal_type: FinancialGoalType;
  target_amount: string;
  starting_debt_amount: string;
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

export const emptyGoalForm: GoalFormValues = {
  name: "",
  description: "",
  goal_type: "emergency",
  target_amount: "",
  starting_debt_amount: "",
  target_date: "",
  linked_account: "",
  linked_credit_account: "",
  monthly_contribution: "0",
  priority: 3,
  include_in_safe_to_spend: true,
  forecast_enabled: true,
  auto_fund_enabled: false,
  notes: "",
  funding: {
    enabled: false,
    incomeRuleId: "",
    amountMode: "fixed",
    fixedAmount: "",
    percent: "",
  },
};

export function buildGoalBucketPayload(householdId: number, values: GoalFormValues) {
  const isDebt = values.goal_type === "debt_payoff";
  const bucketType = goalTypeToBucketType(values.goal_type);
  return {
    household: householdId,
    name: values.name.trim(),
    type: bucketType,
    description: values.description?.trim() ?? "",
    target_amount:
      isDebt && values.starting_debt_amount && parseFloat(values.target_amount) <= 0
        ? values.starting_debt_amount
        : values.target_amount,
    target_date: values.target_date || null,
    linked_account: isDebt ? values.linked_credit_account || null : values.linked_account || null,
    monthly_target: values.monthly_contribution || "0",
    priority: priorityToBucketPriority(values.priority),
    notes: values.notes,
    include_in_safe_to_spend: values.include_in_safe_to_spend,
    forecast_enabled: values.forecast_enabled,
    auto_fund_enabled: values.auto_fund_enabled,
  };
}

export { buildBucketFundingPayload };
