import type { DebtPayoffMode, DebtPayoffStrategy } from "@budget-app/shared";

export type PlannerScenarioInputs = {
  strategy: DebtPayoffStrategy;
  mode: DebtPayoffMode;
  extraMonthly: string;
  lumpSum: string;
  lumpSumAccountId: number | null;
};

export const paymentPlannerQueryKeys = {
  accounts: ["accounts", "debt-planner"] as const,
  plan: (inputs: PlannerScenarioInputs) =>
    [
      "debt-plan",
      inputs.strategy,
      inputs.mode,
      inputs.extraMonthly,
      inputs.lumpSum,
      inputs.lumpSumAccountId,
    ] as const,
  accountPayoff: (accountId: number, strategy: string, amount: string) =>
    ["account-payoff", accountId, strategy, amount] as const,
};
