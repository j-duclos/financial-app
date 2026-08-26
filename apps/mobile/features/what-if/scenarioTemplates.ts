import type { ScenarioTemplateKey } from "@budget-app/shared";

export interface ScenarioTemplateDef {
  key: ScenarioTemplateKey;
  label: string;
  description: string;
  suggestedOverrideHints: string[];
}

export const SCENARIO_TEMPLATES: ScenarioTemplateDef[] = [
  {
    key: "blank",
    label: "Blank scenario",
    description: "Start empty and add your own overrides.",
    suggestedOverrideHints: [],
  },
  {
    key: "buy_house",
    label: "Buy house",
    description: "Model down payment, higher housing costs, and new mortgage payment.",
    suggestedOverrideHints: ["One-time down payment", "Increase rent/mortgage automation", "Property tax & insurance"],
  },
  {
    key: "lose_job",
    label: "Lose job",
    description: "Temporarily disable income automation and add severance if needed.",
    suggestedOverrideHints: ["Disable primary paycheck", "Disable secondary income", "One-time severance"],
  },
  {
    key: "move",
    label: "Move",
    description: "Moving costs, deposit, and updated rent or utilities.",
    suggestedOverrideHints: ["One-time moving costs", "New rent amount", "Utility changes"],
  },
  {
    key: "raise_income",
    label: "Raise income",
    description: "Increase paycheck or side income starting on a date.",
    suggestedOverrideHints: ["Raise paycheck amount with start date"],
  },
  {
    key: "pay_off_debt",
    label: "Pay off debt",
    description: "Extra debt payments and payoff timeline.",
    suggestedOverrideHints: ["Increase card payment automation", "One-time lump sum payment"],
  },
  {
    key: "new_car",
    label: "New car",
    description: "Down payment, loan payment, and insurance changes.",
    suggestedOverrideHints: ["One-time down payment", "New auto payment automation", "Insurance increase"],
  },
  {
    key: "custom",
    label: "Custom",
    description: "Name and describe your own what-if plan.",
    suggestedOverrideHints: [],
  },
];

export const EMPTY_STATE_TEMPLATES = SCENARIO_TEMPLATES.filter((t) =>
  ["buy_house", "lose_job", "raise_income", "pay_off_debt"].includes(t.key)
);

export function templateByKey(key: ScenarioTemplateKey): ScenarioTemplateDef {
  return SCENARIO_TEMPLATES.find((t) => t.key === key) ?? SCENARIO_TEMPLATES[0];
}

export function horizonMonthsToParam(months: number): "3m" | "6m" | "12m" | "24m" {
  if (months <= 3) return "3m";
  if (months <= 6) return "6m";
  if (months <= 12) return "12m";
  return "24m";
}
