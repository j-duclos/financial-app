import React, { useEffect, useMemo, useState } from "react";
import { RefreshControl, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import type { DebtPayoffMode, DebtPayoffStrategy, PayoffStrategy } from "@budget-app/shared";
import {
  AppHeader,
  Button,
  EmptyState,
  ErrorState,
  Screen,
  SectionHeader,
  SkeletonBlock,
} from "@/components/ui";
import { useTheme } from "@/theme";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { describeApiError } from "@/services/api";
import { DebtDetailSheet } from "./DebtDetailSheet";
import { DebtPriorityRow } from "./DebtPriorityRow";
import { PlannerSummaryCard } from "./PlannerSummaryCard";
import { StrategyModePanel } from "./StrategyModePanel";
import { WhatIfPanel } from "./WhatIfPanel";
import {
  parseDebtModeParam,
  planIsRecalculating,
  topRecommendation,
  WHAT_IF_NUMERIC_DEBOUNCE_MS,
} from "./display";
import { planDetailsPath } from "./navigation";
import type { PlannerScenarioInputs } from "./queryKeys";
import {
  useAccountPayoffProjection,
  useCreditCardsFromAccounts,
  useDebtPayoffPlan,
  usePaymentPlannerAccounts,
} from "./usePaymentPlannerData";
import { targetUtilizationPercent } from "./display";

export function PaymentPlannerScreen() {
  const theme = useTheme();
  const router = useRouter();
  const params = useLocalSearchParams<{
    account?: string;
    strategy?: string;
    amount?: string;
    mode?: string;
  }>();

  const [strategy, setStrategy] = useState<DebtPayoffStrategy>("avalanche");
  const [mode, setMode] = useState<DebtPayoffMode>(
    () => parseDebtModeParam(params.mode) ?? "aggressive"
  );
  const [extraMonthly, setExtraMonthly] = useState("150");
  const [lumpSum, setLumpSum] = useState("");
  const [lumpSumAccountId, setLumpSumAccountId] = useState<number | null>(null);
  const [selectedAccountId, setSelectedAccountId] = useState<number | null>(
    params.account ? Number(params.account) : null
  );
  const [cardStrategy, setCardStrategy] = useState<PayoffStrategy>("minimum_payment");
  const [amountInput, setAmountInput] = useState(params.amount ?? "");

  const debouncedExtraMonthly = useDebouncedValue(extraMonthly, WHAT_IF_NUMERIC_DEBOUNCE_MS);
  const debouncedLumpSum = useDebouncedValue(lumpSum, WHAT_IF_NUMERIC_DEBOUNCE_MS);

  const scenarioInputs: PlannerScenarioInputs = useMemo(
    () => ({
      strategy,
      mode,
      extraMonthly: debouncedExtraMonthly,
      lumpSum: debouncedLumpSum,
      lumpSumAccountId,
    }),
    [strategy, mode, debouncedExtraMonthly, debouncedLumpSum, lumpSumAccountId]
  );

  const accountsQuery = usePaymentPlannerAccounts();
  const creditCards = useCreditCardsFromAccounts(accountsQuery.data?.results);
  const creditCardsById = useMemo(
    () => new Map(creditCards.map((account) => [account.id, account])),
    [creditCards]
  );
  const planQuery = useDebtPayoffPlan(scenarioInputs, creditCards.length > 0);
  const plan = planQuery.data;

  const selectedAccount = useMemo(
    () => creditCards.find((a) => a.id === selectedAccountId) ?? null,
    [creditCards, selectedAccountId]
  );

  const selectedPlanCard = useMemo(
    () => plan?.cards.find((c) => c.account_id === selectedAccountId) ?? null,
    [plan, selectedAccountId]
  );

  useEffect(() => {
    if (params.account) {
      const id = Number(params.account);
      if (Number.isInteger(id) && id > 0) setSelectedAccountId(id);
    }
  }, [params.account]);

  useEffect(() => {
    if (params.strategy === "custom_amount" && params.amount) {
      setCardStrategy("custom_amount");
      setAmountInput(params.amount);
    } else if (params.strategy === "minimum_payment") {
      setCardStrategy("minimum_payment");
    }
  }, [params.strategy, params.amount]);

  const projectionQuery = useAccountPayoffProjection({
    account: selectedAccount,
    planCard: selectedPlanCard,
    strategy: cardStrategy,
    amountInput,
    enabled: !!selectedAccount && !!selectedPlanCard,
  });

  const recalculating = planIsRecalculating(
    { extraMonthly, lumpSum },
    { extraMonthly: debouncedExtraMonthly, lumpSum: debouncedLumpSum },
    planQuery.isFetching
  );

  const refetchAll = () => {
    void accountsQuery.refetch();
    void planQuery.refetch();
  };

  if (accountsQuery.isLoading) {
    return (
      <Screen>
        <AppHeader title="Payment Planner" onBack={() => router.back()} />
        <SkeletonBlock lines={6} />
      </Screen>
    );
  }

  if (creditCards.length === 0) {
    return (
      <Screen>
        <AppHeader title="Payment Planner" onBack={() => router.back()} />
        <EmptyState
          title="No credit cards"
          message="Add a credit card account to build a debt payoff plan."
          actionLabel="Add account"
          onAction={() => router.push("/accounts")}
        />
      </Screen>
    );
  }

  return (
    <Screen
      scroll
      scrollProps={{
        refreshControl: (
          <RefreshControl
            refreshing={planQuery.isRefetching && !planQuery.isLoading}
            onRefresh={refetchAll}
            tintColor={theme.colors.tint}
          />
        ),
      }}
    >
      <AppHeader title="Payment Planner" onBack={() => router.back()} />
      <Text style={{ color: theme.colors.textSecondary, marginBottom: 12, ...theme.typography.body }}>
        See which debts to pay first and how extra payments change your projected payoff.
      </Text>

      {planQuery.isError && !plan ? (
        <ErrorState message={describeApiError(planQuery.error)} onRetry={() => planQuery.refetch()} />
      ) : null}

      {plan ? (
        <>
          <PlannerSummaryCard plan={plan} recalculating={recalculating} />
          {topRecommendation(plan) ? (
            <View
              style={{
                backgroundColor: theme.colors.tintMuted,
                padding: theme.spacing.md,
                borderRadius: theme.radius.md,
                marginBottom: theme.spacing.md,
              }}
            >
              <Text style={{ color: theme.colors.text, fontWeight: "600", marginBottom: 4 }}>
                Recommended next action
              </Text>
              <Text style={{ color: theme.colors.textSecondary, ...theme.typography.body }}>
                {topRecommendation(plan)}
              </Text>
            </View>
          ) : null}
        </>
      ) : planQuery.isLoading ? (
        <SkeletonBlock lines={3} />
      ) : null}

      <StrategyModePanel
        strategy={strategy}
        mode={mode}
        onStrategyChange={setStrategy}
        onModeChange={setMode}
      />

      <WhatIfPanel
        extraMonthly={extraMonthly}
        lumpSum={lumpSum}
        lumpSumAccountId={lumpSumAccountId}
        creditCards={creditCards}
        onExtraMonthlyChange={setExtraMonthly}
        onLumpSumChange={setLumpSum}
        onLumpSumAccountChange={setLumpSumAccountId}
      />

      {plan && plan.recommendations.length > 0 ? (
        <View style={{ marginBottom: theme.spacing.md }}>
          <SectionHeader title="Recommendations" />
          {plan.recommendations.map((rec) => (
            <Text
              key={rec.id}
              style={{ color: theme.colors.textSecondary, ...theme.typography.body, marginBottom: 4 }}
            >
              • {rec.message}
            </Text>
          ))}
        </View>
      ) : null}

      {plan && plan.timeline.length > 0 ? (
        <Button
          label="View month-by-month projection"
          variant="secondary"
          onPress={() =>
            router.push({
              pathname: planDetailsPath(),
              params: {
                strategy,
                mode,
                extraMonthly: debouncedExtraMonthly,
                lumpSum: debouncedLumpSum,
                lumpSumAccountId: lumpSumAccountId ? String(lumpSumAccountId) : "",
              },
            })
          }
          style={{ marginBottom: theme.spacing.md }}
        />
      ) : null}

      {plan ? (
        <>
          <SectionHeader title="Payoff order" subtitle="Tap a debt for payment scenarios" />
          {plan.cards.map((card) => {
            const account = creditCardsById.get(card.account_id);
            return (
              <DebtPriorityRow
                key={card.account_id}
                card={card}
                selected={selectedAccountId === card.account_id}
                targetUtilization={account ? targetUtilizationPercent(account) : undefined}
                onPress={() =>
                  setSelectedAccountId((prev) =>
                    prev === card.account_id ? null : card.account_id
                  )
                }
              />
            );
          })}
        </>
      ) : null}

      {selectedAccount && selectedPlanCard ? (
        <DebtDetailSheet
          visible
          account={selectedAccount}
          planCard={selectedPlanCard}
          globalPlan={plan}
          cardStrategy={cardStrategy}
          amountInput={amountInput}
          onStrategyChange={setCardStrategy}
          onAmountChange={setAmountInput}
          projection={projectionQuery.data}
          projectionLoading={projectionQuery.isFetching}
          projectionError={
            projectionQuery.error instanceof Error ? projectionQuery.error.message : null
          }
          onClose={() => setSelectedAccountId(null)}
        />
      ) : null}
    </Screen>
  );
}
