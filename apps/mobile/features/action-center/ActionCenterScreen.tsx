import React, { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshControl, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  actionCenterMobileSummaryText,
  buildActionCenterView,
  recommendationsEmptyMessage,
  recommendationsForActionCenter,
} from "@budget-app/shared";
import { getRecommendations, listAccounts } from "@budget-app/api-client";
import {
  AppHeader,
  EmptyState,
  ErrorState,
  Screen,
  SkeletonBlock,
} from "@/components/ui";
import { useTheme } from "@/theme";
import { usePageForecastWindow } from "@/hooks/usePageForecastWindow";
import { describeApiError } from "@/services/api";
import { ForecastWindowSelect } from "@/features/dashboard/ForecastWindowSelect";
import { RecommendationCard } from "./RecommendationCard";
import { ResolveRiskSheet } from "./ResolveRiskSheet";
import { SurvivalModeBanner } from "./SurvivalModeBanner";
import {
  dismissRecommendation,
  loadDismissedRecommendationIds,
  loadSnoozedRecommendationIds,
  restoreRecommendation,
  snoozeRecommendation,
  unsnoozeRecommendation,
} from "./recommendationStorage";
import { actionCenterQueryKeys, invalidateActionCenterQueries } from "./queryKeys";

export function ActionCenterScreen() {
  const theme = useTheme();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { forecastDays, setForecastDays, ready: forecastReady } = usePageForecastWindow();
  const [storageReady, setStorageReady] = useState(false);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [snoozed, setSnoozed] = useState<Set<string>>(new Set());
  const [storageRefresh, setStorageRefresh] = useState(0);
  const [resolveRiskAccountId, setResolveRiskAccountId] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [d, s] = await Promise.all([
        loadDismissedRecommendationIds(),
        loadSnoozedRecommendationIds(),
      ]);
      if (cancelled) return;
      setDismissed(d);
      setSnoozed(s);
      setStorageReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [storageRefresh]);

  const {
    data,
    isLoading,
    isError,
    error,
    refetch,
    isFetching,
  } = useQuery({
    queryKey: actionCenterQueryKeys.recommendations(forecastDays),
    queryFn: () => getRecommendations({ days: forecastDays }),
    staleTime: 60_000,
    enabled: forecastReady,
  });

  const { data: accountsData } = useQuery({
    queryKey: actionCenterQueryKeys.accounts(),
    queryFn: () => listAccounts({ active_only: true, page_size: 500 }),
    staleTime: 120_000,
  });

  const accounts = accountsData?.results ?? [];
  const accountsById = useMemo(() => new Map(accounts.map((a) => [a.id, a])), [accounts]);

  const entries = useMemo(() => {
    void storageRefresh;
    if (!data || !storageReady) return [];
    return recommendationsForActionCenter(data.recommendations, undefined, dismissed, snoozed);
  }, [data, dismissed, snoozed, storageReady, storageRefresh]);

  const view = useMemo(() => buildActionCenterView(entries), [entries]);

  const bumpStorage = useCallback(() => {
    setStorageRefresh((n) => n + 1);
  }, []);

  const onRecommendationChanged = useCallback(async () => {
    invalidateActionCenterQueries(queryClient);
    bumpStorage();
  }, [bumpStorage, queryClient]);

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
            refreshing={isFetching && !isLoading}
            onRefresh={() => {
              void refetch();
              bumpStorage();
            }}
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

      {(!forecastReady || isLoading || !storageReady) && (
        <SkeletonBlock lines={8} />
      )}

      {isError ? (
        <ErrorState message={describeApiError(error)} onRetry={() => refetch()} />
      ) : null}

      {data && !isLoading && storageReady ? (
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
                      void snoozeRecommendation(entry.rec.id).then(onRecommendationChanged);
                    }}
                    onDismiss={() => {
                      void dismissRecommendation(entry.rec.id).then(onRecommendationChanged);
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
                      void unsnoozeRecommendation(entry.rec.id).then(onRecommendationChanged);
                    }}
                    onRestore={() => {
                      void restoreRecommendation(entry.rec.id).then(onRecommendationChanged);
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
          onChanged={onRecommendationChanged}
        />
      ) : null}
    </Screen>
  );
}
