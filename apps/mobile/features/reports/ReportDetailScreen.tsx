import React, { useMemo, useState } from "react";
import { RefreshControl, ScrollView, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { currentMonthStr, REPORTS_ADVANCED_CASH_FLOW_MESSAGE } from "@budget-app/shared";
import { AppHeader, Button, Card, EmptyState, ErrorState, Screen, SkeletonBlock } from "@/components/ui";
import { PeriodSelector } from "@/features/budget/PeriodSelector";
import { currentPeriodAnchor, periodAnchorFromDate, shiftPeriodAnchor } from "@/features/budget/periodUtils";
import { useTheme } from "@/theme";
import { describeApiError } from "@/services/api";
import { usePremiumUpgrade } from "@/hooks/usePremiumUpgrade";
import { UPGRADE_TO_PREMIUM_LABEL } from "@/lib/billing";
import {
  CashFlowSection,
  DebtSection,
  GoalsSection,
  OverviewSection,
  SpendingSection,
} from "./components/ReportSections";
import { categoryDetailPath, parseReportRouteParams } from "./navigation";
import { formatMonthLabel, parseReportTypeParam, reportTabLabel } from "./reportDisplay";
import type { ReportFilters, ReportHistoryMonths } from "./types";
import { useReportsData } from "./useReportsData";

export function ReportDetailScreen() {
  const theme = useTheme();
  const router = useRouter();
  const params = useLocalSearchParams<{
    type: string;
    month?: string;
    months?: string;
    section?: string;
  }>();
  const reportType = parseReportTypeParam(params.type);
  const [pullRefreshing, setPullRefreshing] = useState(false);
  const { startUpgrade } = usePremiumUpgrade();

  const routeFilters = parseReportRouteParams(params);
  const filters: ReportFilters = useMemo(
    () => ({
      monthKey: routeFilters?.monthKey ?? currentMonthStr(),
      historyMonths: routeFilters?.historyMonths ?? 12,
    }),
    [routeFilters]
  );
  const expandLimits = routeFilters?.section === "limits";

  const period = periodAnchorFromDate(`${filters.monthKey}-15`);
  const {
    data,
    householdReady,
    householdId,
    reportsAdvanced,
    isLoading,
    isError,
    error,
    isFetching,
    isPlaceholderData,
    refetch,
    monthKey,
  } = useReportsData(filters);

  const dataMatchesMonth = data != null && data.month === monthKey;
  const updatingPeriod = Boolean(
    (isFetching || isPlaceholderData || (data != null && !dataMatchesMonth)) && !pullRefreshing
  );

  if (!reportType) {
    return (
      <Screen scroll={false}>
        <AppHeader title="Reports" onBack={() => router.back()} />
        <ErrorState message="Unknown report type." onRetry={() => router.back()} />
      </Screen>
    );
  }

  const onCategoryPress = (categoryId: number, categoryName: string) => {
    router.push(categoryDetailPath(categoryId, filters, categoryName));
  };

  const onHistoryMonthsChange = (months: ReportHistoryMonths) => {
    if (!reportsAdvanced) return;
    router.setParams({ months: String(months) });
  };

  const onPullRefresh = async () => {
    setPullRefreshing(true);
    try {
      await refetch();
    } finally {
      setPullRefreshing(false);
    }
  };

  if (!householdReady) {
    return (
      <Screen scroll={false}>
        <AppHeader title={reportTabLabel(reportType)} onBack={() => router.back()} />
        <View style={{ padding: 16 }}>
          <SkeletonBlock lines={6} />
        </View>
      </Screen>
    );
  }

  if (householdId == null) {
    return (
      <Screen scroll={false}>
        <AppHeader title={reportTabLabel(reportType)} onBack={() => router.back()} />
        <EmptyState
          title="Default household required"
          message="Set a default household in Profile & Settings on web to view reports."
        />
      </Screen>
    );
  }

  return (
    <Screen scroll={false}>
      <AppHeader title={reportTabLabel(reportType)} onBack={() => router.back()} />
      <ScrollView
        contentContainerStyle={{ padding: theme.spacing.lg, paddingBottom: 32 }}
        refreshControl={<RefreshControl refreshing={pullRefreshing} onRefresh={onPullRefresh} />}
      >
        <PeriodSelector
          period={period}
          onPrev={() =>
            router.setParams({
              month: shiftPeriodAnchor(period, -1).monthKey,
            })
          }
          onNext={() =>
            router.setParams({
              month: shiftPeriodAnchor(period, 1).monthKey,
            })
          }
          onToday={() =>
            router.setParams({
              month: currentPeriodAnchor().monthKey,
            })
          }
        />

        {updatingPeriod ? (
          <Text style={{ color: theme.colors.textMuted, fontSize: 11, marginBottom: 8 }}>
            Updating {formatMonthLabel(monthKey)}…
          </Text>
        ) : null}

        {isLoading && !data ? (
          <SkeletonBlock lines={6} />
        ) : isError && !data ? (
          <ErrorState message={describeApiError(error)} onRetry={() => void refetch()} />
        ) : data && dataMatchesMonth ? (
          <>
            {isError ? (
              <Text style={{ color: theme.colors.warning, fontSize: 13, marginBottom: 12 }}>
                Showing cached data — refresh failed.
              </Text>
            ) : null}
            {reportType === "overview" ? <OverviewSection data={data} filters={filters} /> : null}
            {reportType === "cash-flow" ? (
              reportsAdvanced ? (
                <CashFlowSection
                  data={data}
                  historyMonths={filters.historyMonths}
                  onHistoryMonthsChange={onHistoryMonthsChange}
                />
              ) : (
                <Card>
                  <Text style={{ color: theme.colors.text, fontWeight: "700", marginBottom: 8 }}>
                    Cash Flow
                  </Text>
                  <Text style={{ color: theme.colors.textSecondary, fontSize: 14, marginBottom: 12 }}>
                    {REPORTS_ADVANCED_CASH_FLOW_MESSAGE}
                  </Text>
                  <Button label={UPGRADE_TO_PREMIUM_LABEL} onPress={() => void startUpgrade()} />
                </Card>
              )
            ) : null}
            {reportType === "spending" ? (
              <SpendingSection
                data={data}
                filters={filters}
                onCategoryPress={onCategoryPress}
                initiallyExpandLimits={expandLimits}
              />
            ) : null}
            {reportType === "goals" ? (
              <GoalsSection data={data} showFundingHistory={reportsAdvanced} />
            ) : null}
            {reportType === "debt" ? <DebtSection data={data} showInterestHistory={reportsAdvanced} /> : null}
          </>
        ) : updatingPeriod ? (
          <SkeletonBlock lines={6} />
        ) : null}
      </ScrollView>
    </Screen>
  );
}
