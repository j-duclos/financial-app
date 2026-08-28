import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { RefreshControl, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { getDashboardDetails, getDashboardSummaryFast } from "@budget-app/api-client";
import {
  attentionCardsForDisplay,
} from "@budget-app/shared";
import {
  Card,
  EmptyState,
  Screen,
  StatusChip,
} from "@/components/ui";
import { useTheme } from "@/theme";
import { usePageForecastWindow } from "@/hooks/usePageForecastWindow";
import { useExtendedCashRisk } from "@/hooks/useExtendedCashRisk";
import { describeApiError } from "@/services/api";
import { ForecastWindowSelect } from "./ForecastWindowSelect";
import { DASHBOARD_SECTION } from "./terminology";
import {
  isDashboardOnboarding,
  isLookingAheadVisible,
  lookingAheadMessage,
  topSummaryFromDashboard,
} from "./display";
import { DashboardGoalsSection, DashboardUpcomingSection } from "./DashboardDetailsSections";
import { FinancialHealthSection } from "./FinancialHealthSection";
import { AttentionRequiredSection } from "./AttentionRequiredSection";
import { accountsAttentionFilterPath } from "./navigation";
import { markDashboardTiming } from "./dashboardTiming";
import {
  buildUpcomingDashboardPreview,
} from "@budget-app/shared";
import {
  dashboardDetailsSectionState,
  isDashboardAttentionLoading,
} from "./dashboardSectionState";
import { prefetchVisibleAttentionDestinations } from "./attentionPrefetch";

export function DashboardScreen() {
  const theme = useTheme();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { forecastDays, setForecastDays, ready: forecastReady } = usePageForecastWindow();
  const [pullRefreshing, setPullRefreshing] = useState(false);
  const attentionPrefetchedRef = useRef(false);

  useEffect(() => {
    markDashboardTiming("home-mounted");
  }, []);

  useEffect(() => {
    if (forecastReady) {
      markDashboardTiming("summary-fast-request-start");
    }
  }, [forecastReady]);

  const {
    data: summaryFast,
    isLoading: fastLoading,
    isSuccess: fastSuccess,
    isError: fastError,
    error: fastErr,
    refetch: refetchFast,
    isFetching: fastFetching,
    isPlaceholderData: fastIsPlaceholderData,
  } = useQuery({
    queryKey: ["dashboard-summary-fast", forecastDays],
    queryFn: () => getDashboardSummaryFast({ forecast_days: forecastDays }),
    enabled: forecastReady,
    placeholderData: keepPreviousData,
  });

  useEffect(() => {
    if (summaryFast && !fastIsPlaceholderData) {
      markDashboardTiming("summary-fast-response");
    }
  }, [summaryFast, fastIsPlaceholderData]);

  // Details and extended risk reuse forecast/timeline context seeded by summary-fast.
  const dependentQueriesEnabled = forecastReady && fastSuccess && !fastIsPlaceholderData;

  useEffect(() => {
    if (dependentQueriesEnabled) {
      markDashboardTiming("details-request-start");
    }
  }, [dependentQueriesEnabled, forecastDays]);

  const {
    data: details,
    isError: detailsError,
    error: detailsErr,
    refetch: refetchDetails,
    isFetching: detailsFetching,
    isPlaceholderData: detailsIsPlaceholderData,
  } = useQuery({
    queryKey: ["dashboard-summary-details", forecastDays],
    queryFn: () => getDashboardDetails({ forecast_days: forecastDays }),
    enabled: dependentQueriesEnabled,
    placeholderData: keepPreviousData,
  });

  useEffect(() => {
    if (details && !detailsIsPlaceholderData) {
      markDashboardTiming("details-response");
    }
  }, [details, detailsIsPlaceholderData]);

  const { data: extendedCashRisk, isFetching: extendedFetching } =
    useExtendedCashRisk(dependentQueriesEnabled);
  const lookingAhead = isLookingAheadVisible(extendedCashRisk, forecastDays);

  // Summary-fast includes top_summary; snapshot from details is an optional legacy fallback only.
  const top = useMemo(
    () => (summaryFast ? topSummaryFromDashboard(summaryFast) : null),
    [summaryFast]
  );

  const attention = useMemo(
    () => attentionCardsForDisplay(summaryFast?.attention ?? []),
    [summaryFast?.attention]
  );
  const upcomingGroups = details?.upcoming_groups ?? [];
  const goals = (details?.goals ?? []).slice(0, 3);
  const onboarding = isDashboardOnboarding(summaryFast);

  const upcomingPreview = useMemo(() => {
    const nextIssue = summaryFast?.first_cash_shortfall?.date
      ? {
          risk_date: summaryFast.first_cash_shortfall.date,
          account_name: summaryFast.first_cash_shortfall.account_name ?? undefined,
          projected_balance: summaryFast.first_cash_shortfall.amount ?? null,
          first_negative_transaction_id:
            summaryFast.first_cash_shortfall.first_negative_transaction_id ?? null,
        }
      : undefined;
    return buildUpcomingDashboardPreview(upcomingGroups, nextIssue);
  }, [upcomingGroups, summaryFast?.first_cash_shortfall]);

  const upcomingSectionState = dashboardDetailsSectionState({
    details,
    detailsError,
    fastError,
    isEmpty: upcomingPreview.transactions.length === 0,
  });

  const goalsSectionState = dashboardDetailsSectionState({
    details,
    detailsError,
    fastError,
    isEmpty: goals.length === 0,
  });

  const recalculating =
    (fastFetching && (fastIsPlaceholderData || !!summaryFast)) ||
    (detailsFetching && (detailsIsPlaceholderData || !!details));

  const financialHealthLoading = fastLoading && !summaryFast;
  const attentionLoading = isDashboardAttentionLoading({
    summaryFast,
    fastError,
    fastSuccess,
  });

  const onRefresh = useCallback(async () => {
    setPullRefreshing(true);
    try {
      await refetchFast();
      await Promise.all([
        refetchDetails(),
        queryClient.invalidateQueries({ queryKey: ["extended-cash-risk"] }),
      ]);
    } finally {
      setPullRefreshing(false);
    }
  }, [queryClient, refetchDetails, refetchFast]);

  const refreshing =
    pullRefreshing ||
    (fastFetching && !financialHealthLoading) ||
    (detailsFetching && upcomingSectionState !== "loading") ||
    extendedFetching;

  const onViewAllAttention = useCallback(() => {
    router.push(accountsAttentionFilterPath());
  }, [router]);

  useEffect(() => {
    markDashboardTiming("home-shell-rendered");
  }, []);

  useEffect(() => {
    if (summaryFast && top) {
      markDashboardTiming("financial-health-rendered");
    }
  }, [summaryFast, top]);

  useEffect(() => {
    if (summaryFast && !onboarding && !attentionLoading) {
      markDashboardTiming("attention-rendered");
    }
  }, [summaryFast, onboarding, attentionLoading]);

  useEffect(() => {
    if (upcomingSectionState === "data" || upcomingSectionState === "empty") {
      markDashboardTiming("upcoming-rendered");
    }
  }, [upcomingSectionState]);

  useEffect(() => {
    if (goalsSectionState === "data" || goalsSectionState === "empty") {
      markDashboardTiming("goals-rendered");
    }
  }, [goalsSectionState]);

  useEffect(() => {
    if (summaryFast && details && !fastFetching && !detailsFetching) {
      markDashboardTiming("home-settled");
    }
  }, [summaryFast, details, fastFetching, detailsFetching]);

  // Low-priority prefetch after Details completes — must not compete with dashboard/details.
  useEffect(() => {
    if (attentionPrefetchedRef.current) return;
    if (!summaryFast || fastIsPlaceholderData || onboarding || attention.length === 0) return;
    if (!details || detailsFetching) return;

    attentionPrefetchedRef.current = true;
    prefetchVisibleAttentionDestinations(queryClient, attention);
  }, [
    attention,
    details,
    detailsFetching,
    fastIsPlaceholderData,
    onboarding,
    queryClient,
    summaryFast,
  ]);

  useEffect(() => {
    attentionPrefetchedRef.current = false;
  }, [forecastDays]);

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
            {recalculating ? " · Updating…" : ""}
          </Text>
        </View>
        <ForecastWindowSelect value={forecastDays} onChange={setForecastDays} updating={recalculating} />
      </View>

      <FinancialHealthSection
        forecastDays={forecastDays}
        data={summaryFast}
        top={top}
        loading={financialHealthLoading}
        error={fastError && !summaryFast}
        errorMessage={describeApiError(fastErr)}
        onRetry={() => {
          void refetchFast();
        }}
        recalculating={recalculating && !!summaryFast}
      />

      {lookingAhead && extendedCashRisk?.risk ? (
        <Card
          style={{ marginTop: theme.spacing.lg, backgroundColor: theme.colors.warningBg }}
          onPress={() => router.push("/(app)/(tabs)/calendar")}
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
            onAction={() => router.push("/(app)/(tabs)/accounts")}
          />
        </View>
      ) : null}

      <View style={{ marginTop: theme.spacing.lg }}>
        <AttentionRequiredSection
          forecastDays={forecastDays}
          items={attention}
          totalCount={summaryFast?.attention_total_count ?? 0}
          loading={attentionLoading}
          visible={!onboarding && (attentionLoading || !!summaryFast)}
          onViewAll={onViewAllAttention}
        />
      </View>

      <DashboardUpcomingSection
        sectionState={upcomingSectionState}
        errorMessage={describeApiError(detailsErr)}
        onRetry={() => {
          void refetchDetails();
        }}
        upcomingGroups={upcomingGroups}
        firstCashShortfall={summaryFast?.first_cash_shortfall}
        recalculating={recalculating && !!details}
      />

      <DashboardGoalsSection
        sectionState={goalsSectionState}
        errorMessage={describeApiError(detailsErr)}
        onRetry={() => {
          void refetchDetails();
        }}
        goals={goals}
        recalculating={recalculating && !!details}
      />
    </Screen>
  );
}
