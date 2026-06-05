import type { FinancialGoalType, GoalBucketPriority, GoalBucketType } from "@budget-app/shared";

/** Map legacy goal types to bucket types for API writes. */
export function goalTypeToBucketType(goalType: string): GoalBucketType {
  const map: Record<string, GoalBucketType> = {
    emergency_fund: "emergency",
    savings: "custom",
    house_down_payment: "house",
    college: "education",
    vacation: "vacation",
    purchase: "purchase",
    car: "purchase",
    taxes: "purchase",
    debt_payoff: "debt_payoff",
    custom: "custom",
    emergency: "emergency",
    house: "house",
    education: "education",
    retirement: "retirement",
  };
  return map[goalType] ?? "custom";
}

export function priorityToBucketPriority(
  priority: number | GoalBucketPriority | string
): GoalBucketPriority {
  if (priority === "high" || priority === "medium" || priority === "low") return priority;
  if (typeof priority === "number") {
    if (priority <= 2) return "high";
    if (priority >= 4) return "low";
  }
  return "medium";
}

export function bucketPriorityToNumber(priority: GoalBucketPriority | string): number {
  if (priority === "high") return 1;
  if (priority === "low") return 5;
  return 3;
}

export function normalizeGoalTypeForDisplay(goalType: string): FinancialGoalType {
  return goalType as FinancialGoalType;
}
