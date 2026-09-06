import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { InteractionManager, RefreshControl, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { getDashboardDetails, getDashboardSummaryFast } from "@budget-app/api-client";
import {
  attentionCardsForDisplay,
  EXTENDED_CASH_RISK_QUERY_KEY,
  buildUpcomingDashboardPreview,
  canUsePlaidBankSync,
  isMissingAccounts,
} from "@budget-app/shared";
import {
  Card,
  Screen,
  SkeletonBlock,
  StatusChip,
} from "@/components/ui";
import { useTheme } from "@/theme";
import { usePageForecastWindow } from "@/hooks/usePageForecastWindow";
import { useExtendedCashRisk } from "@/hooks/useExtendedCashRisk";
import { useDefaultHouseholdId } from "@/hooks/useDefaultHouseholdId";
import { useOnboardingStatus } from "@/hooks/useOnboardingStatus";
import { useBillingStatus } from "@/hooks/useBillingStatus";
import { usePremiumUpgrade } from "@/hooks/usePremiumUpgrade";
import { useProfile } from "@/lib/profileQuery";
import { describeApiError } from "@/services/api";
import { getLastViewedTransactionAccountId } from "@/features/transactions/transactionsSession";
import { ForecastWindowSelect } from "./ForecastWindowSelect";
import { DASHBOARD_SECTION } from "./terminology";
import {
  isLookingAheadVisible,
  lookingAheadMessage,
  topSummaryFromDashboard,
} from "./display";
import { DashboardGoalsSection, DashboardUpcomingSection } from "./DashboardDetailsSections";
import { FinancialHealthSection } from "./FinancialHealthSection";
import { DashboardFirstRun } from "./DashboardFirstRun";
import { AttentionRequiredSection } from "./AttentionRequiredSection";
import { attentionViewAllPath } from "./navigation";
import { markDashboardTiming } from "./dashboardTiming";
import {
  dashboardDetailsSectionState,
  isDashboardAttentionLoading,
} from "./dashboardSectionState";
import { prefetchHomeTransactionsDestinations } from "./attentionPrefetch";
import {
  homeTransactionsPrefetchSignature,
  isHomeReadyForTransactionsPrefetch,
} from "./homeTransactionsPrefetchGate";

export function DashboardScreen() {
  const theme = useTheme();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { forecastDays, setForecastDays, ready: forecastReady } = usePageForecastWindow();
  const { householdId } = useDefaultHouseholdId();
  const { data: profile } = useProfile();
  const { status: onboarding, isError: onboardingError } = useOnboardingStatus();
  const { billing } = useBillingStatus();
  const { startUpgrade } = usePremiumUpgrade();
  const isPremium = canUsePlaidBankSync(billing);
  const missingAccounts = isMissingAccounts(onboarding);
  const loadDashboard = forecastReady && (onboardingError || onboarding?.steps.account === true);
  const [pullRefreshing, setPullRefreshing] = useState(false);
  const [extendedRiskEnabled, setExtendedRiskEnabled] = useState(false);
  const transactionsPrefetchSignatureRef = useRef<string | null>(null);

  useEffect(() => {
    markDashboardTiming("home-mounted");
  }, []);

  useEffect(() => {
    if (loadDashboard) {
      markDashboardTiming("summary-fast-request-start");
    }
  }, [loadDashboard]);

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
    enabled: loadDashboard,
    placeholderData: keepPreviousData,
  });

  useEffect(() => {
    if (summaryFast && !fastIsPlaceholderData) {
      markDashboardTiming("summary-fast-response");
    }
  }, [summaryFast, fastIsPlaceholderData]);

  // Details reuses forecast/timeline context seeded by summary-fast.
  // Extended risk is deferred separately so it does not compete with Details first paint.
  const dependentQueriesEnabled = loadDashboard && fastSuccess && !fastIsPlaceholderData;

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

  const detailsSettled =
    dependentQueriesEnabled &&
    !detailsFetching &&
    (detailsError || (!!details && !detailsIsPlaceholderData));

  // Extended risk is secondary — defer until details settled (or use cache immediately).
  useEffect(() => {
    if (!detailsSettled) {
      setExtendedRiskEnabled(false);
      return;
    }
    if (queryClient.getQueryData(EXTENDED_CASH_RISK_QUERY_KEY) != null) {
      setExtendedRiskEnabled(true);
      return;
    }
    let cancelled = false;
    const handle = InteractionManager.runAfterInteractions(() => {
      if (!cancelled) setExtendedRiskEnabled(true);
    });
    return () => {
      cancelled = true;
      handle.cancel();
    };
  }, [detailsSettled, queryClient, forecastDays]);

  useEffect(() => {
    if (extendedRiskEnabled) {
      markDashboardTiming("extended-risk-enabled");
    }
  }, [extendedRiskEnabled]);

  const { data: extendedCashRisk } = useExtendedCashRisk(extendedRiskEnabled);
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
  const firstRun = missingAccounts;

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
        queryClient.invalidateQueries({ queryKey: EXTENDED_CASH_RISK_QUERY_KEY }),
      ]);
    } finally {
      setPullRefreshing(false);
    }
  }, [queryClient, refetchDetails, refetchFast]);

  const onViewAllAttention = useCallback(() => {
    router.push(attentionViewAllPath());
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
    if (summaryFast && !firstRun && !attentionLoading) {
      markDashboardTiming("attention-rendered");
    }
  }, [summaryFast, firstRun, attentionLoading]);

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
    if (
      summaryFast &&
      !fastFetching &&
      !detailsFetching &&
      (details || detailsError)
    ) {
      markDashboardTiming("home-settled");
    }
  }, [summaryFast, details, detailsError, fastFetching, detailsFetching]);

  const homeReadyForPrefetch = isHomeReadyForTransactionsPrefetch({
    onboarding: firstRun,
    summaryFast,
    fastIsPlaceholderData,
    fastFetching,
    detailsFetching,
    upcomingSectionState,
    goalsSectionState,
  });

  useEffect(() => {
    if (homeReadyForPrefetch) {
      markDashboardTiming("home-fully-useful");
    }
  }, [homeReadyForPrefetch]);

  const defaultTransactionsAccountId =
    getLastViewedTransactionAccountId() ?? profile?.default_account ?? null;
  const firstCashShortfallAccountId =
    summaryFast?.first_cash_shortfall?.account_id ?? null;
  const prefetchSignature = homeTransactionsPrefetchSignature({
    forecastDays,
    householdId,
    firstCashShortfallAccountId,
    defaultTransactionsAccountId,
    attention,
  });

  // Low-priority Transactions prefetch after Home is fully useful — must not compete
  // with summary-fast or details first paint. Independent of Extended Risk.
  useEffect(() => {
    if (!homeReadyForPrefetch) return;
    if (transactionsPrefetchSignatureRef.current === prefetchSignature) return;

    let cancelled = false;
    const handle = InteractionManager.runAfterInteractions(() => {
      if (cancelled) return;
      if (transactionsPrefetchSignatureRef.current === prefetchSignature) return;
      transactionsPrefetchSignatureRef.current = prefetchSignature;
      void prefetchHomeTransactionsDestinations(queryClient, {
        attention,
        forecastDays,
        householdId,
        firstCashShortfallAccountId,
        defaultTransactionsAccountId,
      }).catch(() => undefined);
    });

    return () => {
      cancelled = true;
      handle.cancel();
    };
  }, [
    attention,
    defaultTransactionsAccountId,
    firstCashShortfallAccountId,
    forecastDays,
    homeReadyForPrefetch,
    householdId,
    prefetchSignature,
    queryClient,
  ]);

  if (!onboardingError && !onboarding) {
    return (
      <Screen>
        <Text style={{ color: theme.colors.text, ...theme.typography.title }}>Home</Text>
        <View style={{ marginTop: theme.spacing.lg }}>
          <SkeletonBlock lines={4} />
        </View>
      </Screen>
    );
  }

  if (firstRun) {
    return (
      <Screen>
        <Text style={{ color: theme.colors.text, ...theme.typography.title, marginBottom: theme.spacing.md }}>
          Home
        </Text>
        <DashboardFirstRun
          isPremium={isPremium}
          onAddAccount={() => router.push("/account/new")}
          onUpgrade={() => void startUpgrade()}
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
            onRefresh={onRefresh}
            tintColor={theme.colors.tint}
          />
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

      <View style={{ marginTop: theme.spacing.lg }}>
        <AttentionRequiredSection
          forecastDays={forecastDays}
          items={attention}
          totalCount={summaryFast?.attention_total_count ?? 0}
          loading={attentionLoading}
          visible={attentionLoading || !!summaryFast}
          onViewAll={onViewAllAttention}
        />
      </View>

      <DashboardUpcomingSection
        sectionState={upcomingSectionState}
        errorMessage={describeApiError(detailsErr)}
        onRetry={() => {
          void refetchDetails();
        }}
        preview={upcomingPreview}
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
