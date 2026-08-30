import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { getAccountPayoff, getDebtPayoffPlan, listAccounts } from "@budget-app/api-client";
import type { Account, DebtPayoffCardSummary, PayoffStrategy } from "@budget-app/shared";
import { useMemo } from "react";
import {
  buildDrawerPayoffParams,
  drawerStrategyRequiresAmountInput,
  isCreditCardAccount,
} from "./display";
import { paymentPlannerQueryKeys, type PlannerScenarioInputs } from "./queryKeys";

export function usePaymentPlannerAccounts() {
  return useQuery({
    queryKey: paymentPlannerQueryKeys.accounts,
    queryFn: () =>
      listAccounts({
        active_only: true,
        page_size: 500,
        balance: "true",
        account_type: "CREDIT",
      }),
    staleTime: 30_000,
  });
}

export function useCreditCardsFromAccounts(accounts: Account[] | undefined) {
  return useMemo(() => (accounts ?? []).filter(isCreditCardAccount), [accounts]);
}

export function useDebtPayoffPlan(
  inputs: PlannerScenarioInputs,
  enabled: boolean
) {
  return useQuery({
    queryKey: paymentPlannerQueryKeys.plan(inputs),
    queryFn: ({ signal }) =>
      getDebtPayoffPlan(
        {
          strategy: inputs.strategy,
          mode: inputs.mode,
          extra_monthly: inputs.extraMonthly || "0",
          lump_sum: inputs.lumpSum || undefined,
          lump_sum_account: inputs.lumpSumAccountId ?? undefined,
        },
        { signal }
      ),
    enabled,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });
}

type AccountPayoffArgs = {
  account: Account | null;
  planCard: DebtPayoffCardSummary | null;
  strategy: PayoffStrategy;
  amountInput: string;
  enabled: boolean;
};

export function useAccountPayoffProjection({
  account,
  planCard,
  strategy,
  amountInput,
  enabled,
}: AccountPayoffArgs) {
  const projectionEnabled =
    enabled &&
    !!account &&
    !!planCard &&
    (drawerStrategyRequiresAmountInput(strategy)
      ? amountInput.trim() !== "" && Number(amountInput) > 0
      : true);

  return useQuery({
    queryKey: paymentPlannerQueryKeys.accountPayoff(
      account?.id ?? 0,
      strategy,
      amountInput
    ),
    queryFn: async ({ signal }) => {
      if (!account || !planCard) throw new Error("No account selected.");
      return getAccountPayoff(
        account.id,
        buildDrawerPayoffParams(account, planCard, strategy, amountInput),
        { signal }
      );
    },
    enabled: projectionEnabled,
    retry: false,
  });
}
