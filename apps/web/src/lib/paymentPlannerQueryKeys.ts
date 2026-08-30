import type { DebtPayoffMode, DebtPayoffStrategy } from "@budget-app/shared";

/** Scenario inputs that change backend payoff output (query-key dimensions). */
export type PlannerScenarioInputs = {
  strategy: DebtPayoffStrategy;
  mode: DebtPayoffMode;
  /** Neutral baseline is "0" — never invent a production extra payment. */
  extraMonthly: string;
  lumpSum: string;
  lumpSumAccountId: number | null;
};

/**
 * Canonical Payment Planner query-key builders.
 * Keep dimensions aligned with Mobile `apps/mobile/features/payment-planner/queryKeys.ts`.
 */
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
  accountPayoff: (accountId: number | string, strategy: string, amount: string) =>
    ["account-payoff", String(accountId), strategy, amount] as const,
};
