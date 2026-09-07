import React, { useCallback, useMemo, useState } from "react";
import { RefreshControl, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  actionCenterMobileSummaryText,
  buildActionCenterView,
  recommendationPreferenceSets,
  recommendationsEmptyMessage,
  recommendationsForActionCenter,
} from "@budget-app/shared";
import { getRecommendationPreferences, getRecommendations } from "@budget-app/api-client";
import {
  AppHeader,
  EmptyState,
  ErrorState,
  Screen,
  SkeletonBlock,
  Button,
  Card,
} from "@/components/ui";
import { useTheme } from "@/theme";
import { usePageForecastWindow } from "@/hooks/usePageForecastWindow";
import { useDefaultHouseholdId } from "@/hooks/useDefaultHouseholdId";
import { useAccountOptions } from "@/hooks/useAccountOptions";
import { describeApiError } from "@/services/api";
import { ForecastWindowSelect } from "@/features/dashboard/ForecastWindowSelect";
import { RecommendationCard } from "./RecommendationCard";
import { ResolveRiskSheet } from "./ResolveRiskSheet";
import { SurvivalModeBanner } from "./SurvivalModeBanner";
import {
  dismissRecommendation,
  restoreRecommendation,
  snoozeRecommendation,
  unsnoozeRecommendation,
} from "./recommendationStorage";
import { actionCenterQueryKeys, invalidateActionCenterRecommendationQueries } from "./queryKeys";

export function ActionCenterScreen() {
  const theme = useTheme();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { forecastDays, setForecastDays, ready: forecastReady } = usePageForecastWindow();
  const { householdId } = useDefaultHouseholdId();
  const [pullRefreshing, setPullRefreshing] = useState(false);
  const [resolveRiskAccountId, setResolveRiskAccountId] = useState<number | null>(null);
  const resolveRiskOpen = resolveRiskAccountId != null;
  const { accounts } = useAccountOptions({ householdId, enabled: resolveRiskOpen });

  const {
    data,
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: actionCenterQueryKeys.recommendations(forecastDays),
    queryFn: () => getRecommendations({ days: forecastDays }),
    staleTime: 60_000,
    enabled: forecastReady,
  });

  const prefsQuery = useQuery({
    queryKey: actionCenterQueryKeys.preferences(),
    queryFn: getRecommendationPreferences,
    staleTime: 60_000,
    enabled: forecastReady,
  });

  const accountsById = useMemo(() => new Map(accounts.map((a) => [a.id, a])), [accounts]);
  const { dismissed, snoozed } = recommendationPreferenceSets(prefsQuery.data);

  const entries = useMemo(() => {
    if (!data) return [];
    return recommendationsForActionCenter(data.recommendations, undefined, dismissed, snoozed);
  }, [data, dismissed, snoozed]);

  const view = useMemo(() => buildActionCenterView(entries), [entries]);

  const onRecommendationPresentationChanged = useCallback(() => {
    invalidateActionCenterRecommendationQueries(queryClient);
  }, [queryClient]);

  const refreshActionCenter = useCallback(async () => {
    setPullRefreshing(true);
    try {
      await Promise.all([refetch(), prefsQuery.refetch()]);
    } finally {
      setPullRefreshing(false);
    }
  }, [prefsQuery, refetch]);

  const resolveAccountName =
    resolveRiskAccountId != null
      ? accountsById.get(resolveRiskAccountId)?.effective_display_name ?? "Account"
      : "Account";

  const showEmpty =
    data &&
    !isLoading &&
    view.groups.length === 0 &&
    view.inactive.length === 0 &&
    !view.survival;

  return (
    <Screen
      scroll
      scrollProps={{
        refreshControl: (
          <RefreshControl
            refreshing={pullRefreshing}
            onRefresh={() => void refreshActionCenter()}
          />
        ),
      }}
    >
      <AppHeader
        title="Action Center"
        subtitle="What requires my attention?"
        showBack
      />

      <View style={{ marginBottom: theme.spacing.md }}>
        <ForecastWindowSelect value={forecastDays} onChange={setForecastDays} />
      </View>

      {(!forecastReady || isLoading || prefsQuery.isLoading) && (
        <SkeletonBlock lines={8} />
      )}

      {isError ? (
        <ErrorState message={describeApiError(error)} onRetry={() => refetch()} />
      ) : null}

      {data && !isLoading && !prefsQuery.isLoading ? (
        <>
          {view.summary.total > 0 || view.inactive.length > 0 ? (
            <Text
              style={{
                color: theme.colors.textSecondary,
                ...theme.typography.caption,
                marginBottom: theme.spacing.md,
              }}
            >
              {actionCenterMobileSummaryText(view.summary)}
              {view.inactive.length > 0
                ? ` · ${view.inactive.length} snoozed/dismissed`
                : ""}
            </Text>
          ) : null}

          {view.survival ? <SurvivalModeBanner entry={view.survival} /> : null}

          {view.groups.map((group) => (
            <View key={group.key} style={{ marginBottom: theme.spacing.lg }}>
              <Text
                style={{
                  color: theme.colors.textMuted,
                  ...theme.typography.label,
                  marginBottom: theme.spacing.sm,
                  textTransform: "uppercase",
                }}
              >
                {group.label} ({group.count})
              </Text>
              <View style={{ gap: theme.spacing.sm }}>
                {group.entries.map((entry) => (
                  <RecommendationCard
                    key={entry.rec.id}
                    rec={entry.rec}
                    displayState={entry.displayState}
                    account={
                      entry.rec.account_id != null
                        ? accountsById.get(entry.rec.account_id) ?? null
                        : null
                    }
                    router={router}
                    onResolveRisk={setResolveRiskAccountId}
                    onSnooze={() => {
                      void snoozeRecommendation(entry.rec.id).then(onRecommendationPresentationChanged);
                    }}
                    onDismiss={() => {
                      void dismissRecommendation(entry.rec.id).then(onRecommendationPresentationChanged);
                    }}
                  />
                ))}
              </View>
            </View>
          ))}

          {view.inactive.length > 0 ? (
            <View style={{ marginBottom: theme.spacing.lg }}>
              <Text
                style={{
                  color: theme.colors.textMuted,
                  ...theme.typography.label,
                  marginBottom: theme.spacing.sm,
                  textTransform: "uppercase",
                }}
              >
                Snoozed & dismissed ({view.inactive.length})
              </Text>
              <View style={{ gap: theme.spacing.sm }}>
                {view.inactive.map((entry) => (
                  <RecommendationCard
                    key={entry.rec.id}
                    rec={entry.rec}
                    displayState={entry.displayState}
                    account={
                      entry.rec.account_id != null
                        ? accountsById.get(entry.rec.account_id) ?? null
                        : null
                    }
                    router={router}
                    onUnsnooze={() => {
                      void unsnoozeRecommendation(entry.rec.id).then(onRecommendationPresentationChanged);
                    }}
                    onRestore={() => {
                      void restoreRecommendation(entry.rec.id).then(onRecommendationPresentationChanged);
                    }}
                  />
                ))}
              </View>
            </View>
          ) : null}

          {showEmpty ? (
            <EmptyState
              title="Nothing needs attention right now"
              message={recommendationsEmptyMessage().split("\n\n")[1] ?? recommendationsEmptyMessage()}
            />
          ) : null}
        </>
      ) : null}

      {resolveRiskAccountId != null ? (
        <ResolveRiskSheet
          visible
          accountId={resolveRiskAccountId}
          accountName={resolveAccountName}
          forecastDays={forecastDays}
          accounts={accounts}
          router={router}
          onClose={() => setResolveRiskAccountId(null)}
          onPresentationChanged={onRecommendationPresentationChanged}
        />
      ) : null}
    </Screen>
  );
}
