import React, { useEffect, useMemo, useState } from "react";
import { Pressable, RefreshControl, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { formatCurrency } from "@budget-app/shared";
import { getDashboardDetails, getDashboardSummaryFast } from "@budget-app/api-client";
import {
  BalanceDisplay,
  Card,
  EmptyState,
  ErrorState,
  Screen,
  SectionHeader,
  SkeletonBlock,
  StatusChip,
  CurrencyDisplay,
} from "@/components/ui";
import { useTheme } from "@/theme";
import { usePageForecastWindow } from "@/hooks/usePageForecastWindow";
import { useExtendedCashRisk } from "@/hooks/useExtendedCashRisk";
import { describeApiError } from "@/services/api";
import { ForecastWindowSelect } from "./ForecastWindowSelect";
import { DASHBOARD_SECTION, FINANCIAL_HEALTH, lowestForecastBalanceLabel } from "./terminology";
import {
  attentionItemsLimited,
  attentionStatusLabel,
  attentionStatusTone,
  availableCreditSubtitle,
  isDashboardOnboarding,
  isLookingAheadVisible,
  lookingAheadMessage,
  lowestProjectedCashSubtitle,
  topSummaryFromDashboard,
} from "./display";

export function DashboardScreen() {
  const theme = useTheme();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { forecastDays, setForecastDays, ready: forecastReady } = usePageForecastWindow();

  const {
    data: summaryFast,
    isLoading: fastLoading,
    isError: fastError,
    error: fastErr,
    refetch: refetchFast,
    isFetching: fastFetching,
  } = useQuery({
    queryKey: ["dashboard-summary-fast", forecastDays],
    queryFn: () => getDashboardSummaryFast({ forecast_days: forecastDays }),
    enabled: forecastReady,
  });

  const { data: extendedCashRisk } = useExtendedCashRisk(forecastReady && !!summaryFast);
  const lookingAhead = isLookingAheadVisible(extendedCashRisk, forecastDays);

  const [detailsEnabled, setDetailsEnabled] = useState(false);
  useEffect(() => {
    if (!summaryFast || fastError) {
      setDetailsEnabled(false);
      return;
    }
    setDetailsEnabled(false);
    const timer = setTimeout(() => setDetailsEnabled(true), 350);
    return () => clearTimeout(timer);
  }, [summaryFast, fastError, forecastDays]);

  const {
    data: details,
    isLoading: detailsLoading,
    isError: detailsError,
    error: detailsErr,
    refetch: refetchDetails,
  } = useQuery({
    queryKey: ["dashboard-summary-details", forecastDays],
    queryFn: () => getDashboardDetails({ forecast_days: forecastDays }),
    enabled: detailsEnabled,
  });

  const top = useMemo(
    () => (summaryFast ? topSummaryFromDashboard({ ...summaryFast, snapshot: details?.snapshot }) : null),
    [summaryFast, details?.snapshot]
  );

  const attention = attentionItemsLimited(summaryFast?.attention ?? [], 3);
  const upcomingGroups = (details?.upcoming_groups ?? []).slice(0, 5);
  const goals = (details?.goals ?? []).slice(0, 3);
  const onboarding = isDashboardOnboarding(summaryFast);

  const refreshing = fastFetching && !fastLoading;

  const onRefresh = async () => {
    await Promise.all([
      refetchFast(),
      detailsEnabled ? refetchDetails() : Promise.resolve(),
      queryClient.invalidateQueries({ queryKey: ["extended-cash-risk"] }),
    ]);
  };

  return (
    <Screen
      scroll
      scrollProps={{
        refreshControl: (
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.colors.tint} />
        ),
      }}
    >
      <View
        style={{
          flexDirection: "row",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: theme.spacing.md,
          gap: 12,
        }}
      >
        <View style={{ flex: 1 }}>
          <Text style={{ color: theme.colors.text, ...theme.typography.title }}>Home</Text>
          <Text style={{ color: theme.colors.textMuted, ...theme.typography.caption }}>
            {DASHBOARD_SECTION.financialHealth}
          </Text>
        </View>
        <ForecastWindowSelect value={forecastDays} onChange={setForecastDays} />
      </View>

      {!forecastReady || (fastLoading && !summaryFast) ? (
        <Card>
          <SkeletonBlock lines={5} />
        </Card>
      ) : null}

      {fastError ? (
        <ErrorState
          message={describeApiError(fastErr)}
          onRetry={() => {
            void refetchFast();
          }}
        />
      ) : null}

      {summaryFast && top ? (
        <View style={{ gap: theme.spacing.md }}>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: theme.spacing.sm }}>
            <BalanceDisplay
              label={lowestForecastBalanceLabel(forecastDays)}
              amount={summaryFast.lowest_projected_cash?.amount ?? "0"}
              subtitle={
                summaryFast.lowest_projected_cash
                  ? lowestProjectedCashSubtitle(summaryFast.lowest_projected_cash)
                  : "No cash accounts in window"
              }
              accessibilityHint={FINANCIAL_HEALTH.lowestProjectedCash.help}
            />
            <BalanceDisplay
              label={FINANCIAL_HEALTH.availableCash.label}
              amount={top.liquid_cash}
              subtitle={FINANCIAL_HEALTH.availableCash.subtitle}
            />
          </View>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: theme.spacing.sm }}>
            <Pressable
              style={{ flex: 1, minWidth: "46%" }}
              onPress={() => router.push("/accounts")}
              accessibilityRole="button"
              accessibilityLabel="View accounts for available credit"
            >
              <BalanceDisplay
                label={FINANCIAL_HEALTH.availableCredit.label}
                amount={top.available_credit}
                subtitle={availableCreditSubtitle(top.credit_utilization, top.total_credit_limit)}
              />
            </Pressable>
            <BalanceDisplay
              label={FINANCIAL_HEALTH.cashAfterDebt.label}
              amount={top.net_position}
              subtitle={FINANCIAL_HEALTH.cashAfterDebt.subtitle}
            />
          </View>

          {summaryFast.debt ? (
            <Card>
              <Text style={{ color: theme.colors.textMuted, ...theme.typography.label }}>Total debt</Text>
              <CurrencyDisplay amount={summaryFast.debt.total_debt} tone="negative" />
              {summaryFast.debt.debt_free_date ? (
                <Text style={{ color: theme.colors.textSecondary, ...theme.typography.caption, marginTop: 4 }}>
                  Debt-free target {summaryFast.debt.debt_free_date}
                </Text>
              ) : null}
            </Card>
          ) : null}
        </View>
      ) : null}

      {lookingAhead && extendedCashRisk?.risk ? (
        <Card
          style={{ marginTop: theme.spacing.lg, backgroundColor: theme.colors.warningBg }}
          onPress={() => router.push("/calendar")}
        >
          <StatusChip label={DASHBOARD_SECTION.lookingAhead} tone="warning" />
          <Text style={{ color: theme.colors.text, ...theme.typography.body, marginTop: 8 }}>
            {lookingAheadMessage(extendedCashRisk.risk)}
          </Text>
          <Text style={{ color: theme.colors.tint, fontWeight: "600", marginTop: 8 }}>
            View extended forecast
          </Text>
        </Card>
      ) : null}

      {onboarding ? (
        <View style={{ marginTop: theme.spacing.lg }}>
          <EmptyState
            title="Get started with your financial command center"
            message="Connect an account, add recurring bills and income, or create a savings goal."
            actionLabel="Accounts"
            onAction={() => router.push("/accounts")}
          />
        </View>
      ) : null}

      {summaryFast && !onboarding ? (
        <>
          <SectionHeader
            title={DASHBOARD_SECTION.attention}
            subtitle={
              summaryFast.attention_total_count > attention.length
                ? `Showing ${attention.length} of ${summaryFast.attention_total_count}`
                : undefined
            }
            actionLabel="View all"
            onAction={() => router.push("/action-center")}
          />
          {attention.length === 0 ? (
            <EmptyState title="Nothing needs your attention in this window." />
          ) : (
            <View style={{ gap: theme.spacing.sm }}>
              {attention.map((item) => (
                <Card
                  key={`${item.account_id}-${item.reason}`}
                  onPress={() => router.push("/action-center")}
                >
                  <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 8 }}>
                    <Text style={{ color: theme.colors.text, ...theme.typography.bodyStrong, flex: 1 }}>
                      {item.account_name}
                    </Text>
                    <StatusChip
                      label={attentionStatusLabel(item.status)}
                      tone={attentionStatusTone(item.status)}
                    />
                  </View>
                  <Text style={{ color: theme.colors.textSecondary, ...theme.typography.caption, marginTop: 6 }}>
                    {item.reason}
                  </Text>
                  {item.amount != null && String(item.amount).trim() !== "" ? (
                    <CurrencyDisplay amount={item.amount} style={{ marginTop: 8, fontSize: 18 }} />
                  ) : null}
                  {item.recommended_action ? (
                    <Text style={{ color: theme.colors.text, ...theme.typography.caption, marginTop: 6 }}>
                      {item.recommended_action}
                    </Text>
                  ) : null}
                  {item.target_utilization_percent != null &&
                  String(item.target_utilization_percent).trim() !== "" ? (
                    <Text style={{ color: theme.colors.textMuted, ...theme.typography.caption, marginTop: 4 }}>
                      Target utilization {item.target_utilization_percent}%
                    </Text>
                  ) : null}
                </Card>
              ))}
            </View>
          )}
        </>
      ) : null}

      <SectionHeader
        title={DASHBOARD_SECTION.upcoming}
        actionLabel="Calendar"
        onAction={() => router.push("/calendar")}
      />
      {!detailsEnabled || (detailsLoading && !details) ? (
        <Card>
          <SkeletonBlock lines={4} />
        </Card>
      ) : detailsError ? (
        <ErrorState
          message={describeApiError(detailsErr)}
          onRetry={() => {
            void refetchDetails();
          }}
        />
      ) : upcomingGroups.length === 0 ? (
        <EmptyState title="No upcoming money movement in this window." />
      ) : (
        <View style={{ gap: theme.spacing.sm }}>
          {summaryFast?.first_cash_shortfall?.date ? (
            <Card style={{ backgroundColor: theme.colors.criticalBg }}>
              <StatusChip label="First cash shortfall" tone="critical" />
              <Text style={{ color: theme.colors.text, marginTop: 8, ...theme.typography.body }}>
                {summaryFast.first_cash_shortfall.account_name} on{" "}
                {summaryFast.first_cash_shortfall.date}
              </Text>
              {summaryFast.first_cash_shortfall.amount != null ? (
                <CurrencyDisplay
                  amount={summaryFast.first_cash_shortfall.amount}
                  tone="negative"
                  style={{ marginTop: 6 }}
                />
              ) : null}
            </Card>
          ) : null}
          {upcomingGroups.map((group) => (
            <Card key={group.date} onPress={() => router.push("/calendar")}>
              <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                <Text style={{ color: theme.colors.text, ...theme.typography.bodyStrong }}>
                  {group.label}
                </Text>
                <Text style={{ color: theme.colors.textMuted, ...theme.typography.caption }}>
                  {group.day_of_week}
                </Text>
              </View>
              <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 8 }}>
                <Text style={{ color: theme.colors.moneyPositive, ...theme.typography.caption }}>
                  In {formatCurrency(group.income_total)}
                </Text>
                <Text style={{ color: theme.colors.moneyNegative, ...theme.typography.caption }}>
                  Out {formatCurrency(group.expense_total)}
                </Text>
                <CurrencyDisplay amount={group.net_total} style={{ fontSize: 14 }} />
              </View>
              {group.has_risk ? (
                <Text style={{ color: theme.colors.critical, ...theme.typography.caption, marginTop: 6 }}>
                  {group.risk_reason || "Risk day"}
                </Text>
              ) : null}
            </Card>
          ))}
        </View>
      )}

      <SectionHeader
        title={DASHBOARD_SECTION.goals}
        actionLabel="All goals"
        onAction={() => router.push("/goals")}
      />
      {!detailsEnabled || (detailsLoading && !details) ? (
        <Card>
          <SkeletonBlock lines={3} />
        </Card>
      ) : goals.length === 0 ? (
        <EmptyState
          title="No goals yet"
          message="Create a savings or debt goal to track progress here."
          actionLabel="Goals"
          onAction={() => router.push("/goals")}
        />
      ) : (
        <View style={{ gap: theme.spacing.sm, marginBottom: theme.spacing.xl }}>
          {goals.map((goal) => (
            <Card key={goal.id} onPress={() => router.push("/goals")}>
              <Text style={{ color: theme.colors.text, ...theme.typography.bodyStrong }}>{goal.name}</Text>
              <Text style={{ color: theme.colors.textMuted, ...theme.typography.caption, marginTop: 4 }}>
                {formatCurrency(goal.current_amount)} of {formatCurrency(goal.target_amount)} ·{" "}
                {parseFloat(goal.progress_percent).toFixed(0)}%
              </Text>
              {goal.contribution_recommendation || goal.recommended_monthly_contribution ? (
                <Text style={{ color: theme.colors.textSecondary, ...theme.typography.caption, marginTop: 6 }}>
                  {goal.contribution_recommendation ||
                    `Suggested ${formatCurrency(goal.recommended_monthly_contribution!)}/mo`}
                </Text>
              ) : null}
            </Card>
          ))}
        </View>
      )}
    </Screen>
  );
}
