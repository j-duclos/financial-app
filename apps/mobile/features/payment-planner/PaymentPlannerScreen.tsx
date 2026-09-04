import React, { useEffect, useMemo, useState } from "react";
import { Pressable, RefreshControl, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import type { DebtPayoffMode, DebtPayoffStrategy, PayoffStrategy } from "@budget-app/shared";
import {
  AppHeader,
  EmptyState,
  ErrorState,
  Screen,
  SectionHeader,
  SkeletonBlock,
} from "@/components/ui";
import { useTheme } from "@/theme";
import { describeApiError } from "@/services/api";
import { DebtDetailSheet } from "./DebtDetailSheet";
import { DebtPriorityRow } from "./DebtPriorityRow";
import { PlannerSummaryCard } from "./PlannerSummaryCard";
import { StrategyModePanel } from "./StrategyModePanel";
import { WhatIfPanel } from "./WhatIfPanel";
import {
  debtStrategyLabel,
  parseDebtModeParam,
  topRecommendation,
  WHAT_IF_NUMERIC_DEBOUNCE_MS,
} from "./display";
import { planDetailsPath } from "./navigation";
import type { PlannerScenarioInputs } from "./queryKeys";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import {
  useAccountPayoffProjection,
  useCreditCardsFromAccounts,
  useDebtPayoffPlan,
  usePaymentPlannerAccounts,
} from "./usePaymentPlannerData";

/** Neutral baseline — no invented extra payment (backend default is 0). */
const NEUTRAL_EXTRA_MONTHLY = "0";

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
  const [extraMonthly, setExtraMonthly] = useState(NEUTRAL_EXTRA_MONTHLY);
  const [lumpSum, setLumpSum] = useState("");
  const [lumpSumAccountId, setLumpSumAccountId] = useState<number | null>(null);
  const debouncedExtraMonthly = useDebouncedValue(extraMonthly, WHAT_IF_NUMERIC_DEBOUNCE_MS);
  const debouncedLumpSum = useDebouncedValue(lumpSum, WHAT_IF_NUMERIC_DEBOUNCE_MS);
  const [selectedAccountId, setSelectedAccountId] = useState<number | null>(
    params.account ? Number(params.account) : null
  );
  const [cardStrategy, setCardStrategy] = useState<PayoffStrategy>("minimum_payment");
  const [amountInput, setAmountInput] = useState(params.amount ?? "");
  const [appliedAmountInput, setAppliedAmountInput] = useState(params.amount ?? "");
  const [pullRefreshing, setPullRefreshing] = useState(false);

  const lumpReady = Number(debouncedLumpSum) > 0 && lumpSumAccountId != null;
  const scenarioInputs: PlannerScenarioInputs = useMemo(
    () => ({
      strategy,
      mode,
      extraMonthly: debouncedExtraMonthly,
      lumpSum: lumpReady ? debouncedLumpSum : "",
      lumpSumAccountId: lumpReady ? lumpSumAccountId : null,
    }),
    [strategy, mode, debouncedExtraMonthly, debouncedLumpSum, lumpSumAccountId, lumpReady]
  );

  const accountsQuery = usePaymentPlannerAccounts();
  const creditCards = useCreditCardsFromAccounts(accountsQuery.data?.results);
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
      setAppliedAmountInput(params.amount);
    } else if (params.strategy === "minimum_payment") {
      setCardStrategy("minimum_payment");
    }
  }, [params.strategy, params.amount]);

  const projectionQuery = useAccountPayoffProjection({
    account: selectedAccount,
    planCard: selectedPlanCard,
    strategy: cardStrategy,
    amountInput: cardStrategy === "custom_amount" ? appliedAmountInput : amountInput,
    enabled: !!selectedAccount && !!selectedPlanCard,
  });

  /**
   * Backend plan endpoint loads canonical debt data server-side (not from the
   * client account list), so accounts + plan may refetch in parallel safely.
   * We still await both so pullRefreshing covers the full refresh lifecycle.
   */
  const refreshAll = async () => {
    setPullRefreshing(true);
    try {
      await Promise.all([accountsQuery.refetch(), planQuery.refetch()]);
    } finally {
      setPullRefreshing(false);
    }
  };

  const recommended = plan ? topRecommendation(plan) : null;
  const focusCard = plan?.cards.find((c) => c.payoff_order === 1);

  if (accountsQuery.isLoading) {
    return (
      <Screen>
        <AppHeader title="Payment Planner" onBack={() => router.back()} />
        <SkeletonBlock lines={6} />
      </Screen>
    );
  }

  if (accountsQuery.isError) {
    return (
      <Screen>
        <AppHeader title="Payment Planner" onBack={() => router.back()} />
        <ErrorState
          message={describeApiError(accountsQuery.error)}
          onRetry={() => accountsQuery.refetch()}
        />
      </Screen>
    );
  }

  if (accountsQuery.isSuccess && creditCards.length === 0) {
    return (
      <Screen>
        <AppHeader title="Payment Planner" onBack={() => router.back()} />
        <EmptyState
          title="No credit cards"
          message="Add a credit card account to build a debt payoff plan."
          actionLabel="Add account"
          onAction={() => router.push("/(app)/(tabs)/accounts")}
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
            refreshing={pullRefreshing}
            onRefresh={() => void refreshAll()}
            tintColor={theme.colors.tint}
          />
        ),
      }}
    >
      <AppHeader title="Payment Planner" onBack={() => router.back()} />

      {planQuery.isError && !plan ? (
        <ErrorState message={describeApiError(planQuery.error)} onRetry={() => planQuery.refetch()} />
      ) : null}

      {plan ? (
        <>
          <PlannerSummaryCard plan={plan} recalculating={planQuery.isFetching && !planQuery.isLoading} />
          {recommended && focusCard ? (
            <Pressable
              onPress={() => setSelectedAccountId(focusCard.account_id)}
              accessibilityRole="button"
              style={{
                backgroundColor: theme.colors.tintMuted,
                padding: theme.spacing.md,
                borderRadius: theme.radius.md,
                marginBottom: theme.spacing.md,
              }}
            >
              <Text style={{ color: theme.colors.textMuted, ...theme.typography.caption }}>
                Recommended next
              </Text>
              <Text style={{ color: theme.colors.text, fontWeight: "700", marginTop: 2 }}>
                {focusCard.name} · {focusCard.apr}% APR
              </Text>
              <Text style={{ color: theme.colors.textSecondary, ...theme.typography.caption, marginTop: 2 }}>
                Pay this debt first under {debtStrategyLabel(strategy)}.
              </Text>
            </Pressable>
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
        creditCards={creditCards}
        extraMonthly={extraMonthly}
        lumpSum={lumpSum}
        lumpSumAccountId={lumpSumAccountId}
        mode={mode}
        monthlyBudget={plan?.monthly_payment_budget}
        onExtraMonthlyChange={setExtraMonthly}
        onLumpSumChange={setLumpSum}
        onLumpSumAccountChange={setLumpSumAccountId}
        onSwitchToAggressive={() => setMode("aggressive")}
      />

      {plan && plan.recommendations.length > 0 ? (
        <View style={{ marginBottom: theme.spacing.md }}>
          <SectionHeader title="Recommendations" />
          {plan.recommendations.slice(0, 3).map((rec) => (
            <Text
              key={rec.id}
              style={{ color: theme.colors.textSecondary, ...theme.typography.body, marginBottom: 6 }}
            >
              • {rec.message}
            </Text>
          ))}
        </View>
      ) : null}

      {plan && plan.timeline.length > 0 ? (
        <Pressable
          onPress={() =>
            router.push({
              pathname: planDetailsPath(),
              params: {
                strategy,
                mode,
                extraMonthly: extraMonthly,
                lumpSum: lumpSum,
                lumpSumAccountId: lumpSumAccountId
                  ? String(lumpSumAccountId)
                  : "",
              },
            })
          }
          accessibilityRole="button"
          style={{
            minHeight: theme.touchTarget,
            flexDirection: "row",
            alignItems: "center",
            marginBottom: theme.spacing.md,
            borderTopWidth: 1,
            borderBottomWidth: 1,
            borderColor: theme.colors.border,
            paddingVertical: 12,
          }}
        >
          <Text style={{ flex: 1, color: theme.colors.text, fontWeight: "600" }}>
            Month-by-month projection
          </Text>
          <Text style={{ color: theme.colors.textMuted }}>›</Text>
        </Pressable>
      ) : null}

      {plan ? (
        <>
          <SectionHeader title="Payoff order" subtitle="Tap a debt for payment scenarios" />
          {plan.cards.map((card) => (
            <DebtPriorityRow
              key={card.account_id}
              card={card}
              selected={selectedAccountId === card.account_id}
              showUtilization={strategy === "utilization_target" || mode === "credit_score"}
              onPress={() =>
                setSelectedAccountId((prev) =>
                  prev === card.account_id ? null : card.account_id
                )
              }
            />
          ))}
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
          onApplyCustomAmount={(amount) => {
            setAmountInput(amount);
            setAppliedAmountInput(amount);
          }}
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
