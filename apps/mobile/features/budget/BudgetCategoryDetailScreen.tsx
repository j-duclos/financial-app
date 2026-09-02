import React, { useMemo } from "react";
import { ScrollView, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getSpendingTarget } from "@budget-app/api-client";
import type { SpendingTarget } from "@budget-app/shared";
import { formatCurrency } from "@budget-app/shared";
import {
  AppHeader,
  Button,
  Card,
  CurrencyDisplay,
  ErrorState,
  Screen,
  SectionHeader,
  SkeletonBlock,
  StatusChip,
} from "@/components/ui";
import { useTheme } from "@/theme";
import { describeApiError } from "@/services/api";
import { budgetQueryKeys } from "./queryKeys";
import {
  SPENDING_TARGET_STATUS_LABELS,
  parseOptionalMetricAmount,
  spendingTargetCardRows,
  spendingTargetProgressPercent,
  spendingTargetStatusTone,
  spendingTargetPeriodLabel,
} from "./spendingTargetDisplay";
import { currentPeriodAnchor, formatPeriodRange } from "./periodUtils";
import { useDefaultHouseholdId } from "@/hooks/useDefaultHouseholdId";

function findCachedTarget(
  queryClient: ReturnType<typeof useQueryClient>,
  targetId: number
): SpendingTarget | undefined {
  const caches = queryClient.getQueriesData<{ results?: SpendingTarget[] }>({
    queryKey: ["spending-targets"],
  });
  for (const [, data] of caches) {
    const hit = data?.results?.find((t) => t.id === targetId);
    if (hit) return hit;
  }
  return undefined;
}

export function BudgetCategoryDetailScreen() {
  const theme = useTheme();
  const router = useRouter();
  const queryClient = useQueryClient();
  const params = useLocalSearchParams<{ targetId: string; anchor?: string }>();
  const targetId = Number(params.targetId);
  const anchor = params.anchor ?? currentPeriodAnchor().anchor;
  const { householdId } = useDefaultHouseholdId();

  const cachedShell = useMemo(
    () => (Number.isInteger(targetId) ? findCachedTarget(queryClient, targetId) : undefined),
    [queryClient, targetId]
  );

  const targetQuery = useQuery({
    queryKey: budgetQueryKeys.targetDetail(targetId, anchor),
    queryFn: () => getSpendingTarget(targetId, { anchor }),
    enabled: householdId != null && Number.isInteger(targetId) && targetId > 0,
    initialData: cachedShell,
    staleTime: 60_000,
  });

  const target = targetQuery.data;
  const metrics = target?.metrics;

  if (targetQuery.isLoading && !cachedShell) {
    return (
      <Screen scroll={false}>
        <SkeletonBlock lines={6} />
      </Screen>
    );
  }

  if ((targetQuery.isError && !cachedShell) || !target || !metrics) {
    return (
      <Screen scroll={false}>
        <ErrorState message={describeApiError(targetQuery.error)} onRetry={() => targetQuery.refetch()} />
      </Screen>
    );
  }

  const name = target.name || metrics.category_name;
  const pct = spendingTargetProgressPercent(metrics);
  const tone = spendingTargetStatusTone(metrics.status);
  const rows = spendingTargetCardRows(metrics);

  const viewTransactions = () => {
    router.push({
      pathname: "/(app)/(tabs)/transactions",
      params: {
        category: String(metrics.category_id),
        dateFrom: metrics.period_start,
        dateTo: metrics.period_end,
      },
    });
  };

  return (
    <Screen scroll={false}>
      <AppHeader title={name} onBack={() => router.back()} />
      <ScrollView contentContainerStyle={{ gap: theme.spacing.md, paddingBottom: 32 }}>
        {targetQuery.isFetching && !targetQuery.isPending ? (
          <Text style={{ color: theme.colors.textMuted, fontSize: 12 }}>Updating…</Text>
        ) : null}
        <Card>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 8 }}>
            <StatusChip
              label={SPENDING_TARGET_STATUS_LABELS[metrics.status]}
              tone={tone === "critical" ? "critical" : tone === "warning" ? "warning" : "positive"}
            />
            <StatusChip label={spendingTargetPeriodLabel(metrics.period)} tone="neutral" />
          </View>
          <Text style={{ color: theme.colors.textSecondary, fontSize: 13, marginBottom: 12 }}>
            {formatPeriodRange(metrics.period_start, metrics.period_end)}
          </Text>
          <View
            accessibilityRole="progressbar"
            accessibilityValue={{ min: 0, max: 100, now: Math.round(pct), text: `${Math.round(pct)}% used` }}
            style={{
              height: 10,
              borderRadius: 5,
              backgroundColor: theme.colors.surfaceMuted,
              overflow: "hidden",
              marginBottom: 12,
            }}
          >
            <View
              style={{
                height: "100%",
                width: `${Math.min(pct, 100)}%`,
                backgroundColor:
                  tone === "critical"
                    ? theme.colors.critical
                    : tone === "warning"
                      ? theme.colors.warning
                      : theme.colors.moneyPositive,
              }}
            />
          </View>
          <Text style={{ color: theme.colors.textMuted, fontSize: 12, marginBottom: 12 }}>
            {Math.round(pct)}% used · includes {formatCurrency(metrics.scheduled_in_period ?? "0")} upcoming
          </Text>
          {rows.map((row) => (
            <View key={row.label} style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 6 }}>
              <Text style={{ color: theme.colors.textSecondary }}>{row.label}</Text>
              <CurrencyDisplay
                amount={row.amount}
                tone={
                  row.label === "Remaining" && (parseOptionalMetricAmount(row.amount) ?? 0) < 0
                    ? "negative"
                    : "neutral"
                }
                style={{ fontSize: 16 }}
              />
            </View>
          ))}
        </Card>

        {metrics.recommendation ? (
          <Card>
            <SectionHeader title="Recommendation" />
            <Text style={{ color: theme.colors.text, ...theme.typography.body }}>{metrics.recommendation}</Text>
          </Card>
        ) : null}

        {metrics.forecast_summary ? (
          <Card>
            <SectionHeader title="Forecast impact" />
            <Text style={{ color: theme.colors.textSecondary, ...theme.typography.body }}>{metrics.forecast_summary}</Text>
          </Card>
        ) : null}

        <Button label="View related transactions" onPress={viewTransactions} />
        <Button
          label="Edit spending limit"
          variant="secondary"
          onPress={() => router.push(`/spending-limits/edit/${target.id}`)}
        />
      </ScrollView>
    </Screen>
  );
}
