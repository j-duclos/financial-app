import React, { useMemo } from "react";
import { FlatList, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { formatCurrency } from "@budget-app/shared";
import type { DebtPayoffMode, DebtPayoffStrategy } from "@budget-app/shared";
import { AppHeader, ErrorState, Screen, SkeletonBlock } from "@/components/ui";
import { useTheme } from "@/theme";
import { formatDateDisplay } from "@/lib/dates";
import { describeApiError } from "@/services/api";
import { parseDebtModeParam } from "./display";
import type { PlannerScenarioInputs } from "./queryKeys";
import {
  useCreditCardsFromAccounts,
  useDebtPayoffPlan,
  usePaymentPlannerAccounts,
} from "./usePaymentPlannerData";

const PAGE_SIZE = 24;

export function PlanDetailsScreen() {
  const theme = useTheme();
  const router = useRouter();
  const params = useLocalSearchParams<{
    strategy?: string;
    mode?: string;
    extraMonthly?: string;
    lumpSum?: string;
    lumpSumAccountId?: string;
  }>();

  const scenarioInputs: PlannerScenarioInputs = useMemo(
    () => ({
      strategy: (params.strategy as DebtPayoffStrategy) ?? "avalanche",
      mode: parseDebtModeParam(params.mode) ?? "aggressive",
      extraMonthly: params.extraMonthly ?? "0",
      lumpSum: params.lumpSum ?? "",
      lumpSumAccountId: params.lumpSumAccountId
        ? Number(params.lumpSumAccountId)
        : null,
    }),
    [params]
  );

  const accountsQuery = usePaymentPlannerAccounts();
  const creditCards = useCreditCardsFromAccounts(accountsQuery.data?.results);
  const planQuery = useDebtPayoffPlan(scenarioInputs, creditCards.length > 0);
  const plan = planQuery.data;

  const accountNames = useMemo(() => {
    const map = new Map<number, string>();
    for (const card of plan?.cards ?? []) {
      map.set(card.account_id, card.name);
    }
    return map;
  }, [plan?.cards]);

  if (planQuery.isLoading) {
    return (
      <Screen scroll={false}>
        <AppHeader title="Plan projection" onBack={() => router.back()} />
        <SkeletonBlock lines={8} />
      </Screen>
    );
  }

  if (planQuery.isError || !plan) {
    return (
      <Screen>
        <AppHeader title="Plan projection" onBack={() => router.back()} />
        <ErrorState message={describeApiError(planQuery.error)} onRetry={() => planQuery.refetch()} />
      </Screen>
    );
  }

  return (
    <Screen scroll={false} contentStyle={{ paddingHorizontal: 0 }}>
      <View style={{ paddingHorizontal: theme.spacing.lg }}>
        <AppHeader title="Plan projection" onBack={() => router.back()} />
        <Text style={{ color: theme.colors.textSecondary, ...theme.typography.body, marginBottom: 12 }}>
          Month-by-month projection from the server. Not scheduled payments.
        </Text>
        {plan.debt_free_date ? (
          <Text style={{ color: theme.colors.text, fontWeight: "600", marginBottom: 12 }}>
            Estimated debt-free: {formatDateDisplay(plan.debt_free_date)}
          </Text>
        ) : null}
      </View>

      <FlatList
        data={plan.timeline}
        keyExtractor={(item) => String(item.month)}
        initialNumToRender={PAGE_SIZE}
        maxToRenderPerBatch={PAGE_SIZE}
        windowSize={5}
        contentContainerStyle={{ paddingHorizontal: theme.spacing.lg, paddingBottom: 24 }}
        renderItem={({ item }) => (
          <View
            style={{
              borderWidth: 1,
              borderColor: theme.colors.border,
              borderRadius: theme.radius.md,
              padding: theme.spacing.md,
              marginBottom: theme.spacing.sm,
              backgroundColor: theme.colors.surface,
            }}
          >
            <Text style={{ color: theme.colors.text, fontWeight: "700" }}>
              Month {item.month} · {formatDateDisplay(item.date)}
            </Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12, marginTop: 8 }}>
              <Mini label="Total balance" value={formatCurrency(item.total_balance)} />
              <Mini label="Interest" value={formatCurrency(item.interest_charged)} />
              <Mini label="Paid" value={formatCurrency(item.total_paid)} />
            </View>
            {Object.entries(item.balances_by_account).length > 0 ? (
              <View style={{ marginTop: 8, gap: 4 }}>
                {Object.entries(item.balances_by_account).map(([accountId, balance]) => (
                  <Text
                    key={accountId}
                    style={{ color: theme.colors.textMuted, ...theme.typography.caption }}
                  >
                    {accountNames.get(Number(accountId)) ?? `Account ${accountId}`}:{" "}
                    {formatCurrency(balance)}
                  </Text>
                ))}
              </View>
            ) : null}
          </View>
        )}
        ListEmptyComponent={
          <Text style={{ color: theme.colors.textMuted, textAlign: "center", marginTop: 24 }}>
            No projection timeline available for this scenario.
          </Text>
        }
      />
    </Screen>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  const theme = useTheme();
  return (
    <View>
      <Text style={{ color: theme.colors.textMuted, fontSize: 11 }}>{label}</Text>
      <Text style={{ color: theme.colors.text, fontWeight: "600", fontSize: 13 }}>{value}</Text>
    </View>
  );
}
