export type ForecastHorizon = "3m" | "6m" | "12m" | "24m";

export type EventPreset = "income" | "expense" | "transfer";

export type OverrideContext = "debt" | "paycheck" | "expense_change";

export type IncomeChangeKind = "one_time" | "paycheck" | "new_recurring";

export type ExpenseChangeKind = "one_time" | "current" | "new_recurring";

export type NewRecurringDirection = "INCOME" | "EXPENSE";

export type PlanSummaryResult = "SAFE" | "IMPROVED, BUT STILL AT RISK" | "WORSE" | "NO CHANGE";

export type AddChangeAction =
  | { type: "income_kind" }
  | { type: "expense_kind" }
  | { type: "transfer" }
  | { type: "pay_down_debt" }
  | { type: "recurring_debt" };

export type EditTarget =
  | { kind: "override"; id: number }
  | { kind: "event"; id: number }
  | { kind: "shock"; id: number }
  | { kind: "added_recurring"; id: number };
