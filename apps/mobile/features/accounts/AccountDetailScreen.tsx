import React, { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshControl, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getAccount, listAccounts, listTransactions } from "@budget-app/api-client";
import type { PaginatedResponse } from "@budget-app/api-client";
import {
  DEFAULT_TARGET_UTILIZATION_PERCENT,
  formatCurrency,
  getAccountInstitutionSubtitle,
  getEffectiveDisplayName,
  type Account,
  type OperationalForecastDays,
} from "@budget-app/shared";
import {
  AppHeader,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Screen,
  SectionHeader,
  SkeletonBlock,
  UtilizationDisplay,
} from "@/components/ui";
import { useTheme } from "@/theme";
import { usePageForecastWindow } from "@/hooks/usePageForecastWindow";
import { describeApiError } from "@/services/api";
import { todayStr } from "@/lib/dates";
import { TransactionRowCard } from "@/features/transactions/TransactionRowCard";
import { defaultLedgerTimelineQueryOptions } from "@/features/transactions/defaultLedgerPrefetch";
import { isPendingExpectedTimelineRow } from "@/features/transactions/pendingSemantics";
import { transactionsForAccountPath } from "@/features/payment-planner/navigation";
import { reconcilePath } from "@/features/reconcile/navigation";
import { rememberTransactionAccountSelection } from "@/features/transactions/accountSelection";
import { resolveAccountBalanceDisplay } from "./accountBalanceDisplay";
import { accountDetailUpcomingPreviewRows } from "./accountDetailUpcomingPreview";
import {
  accountHasForecastEnrichment,
  seedAccountFromListCache,
  seedBalanceDetailFromListCache,
} from "./accountDetailSeed";
import { ACCOUNT_DETAIL_PREVIEW_LIMIT, accountQueryKeys } from "./queryKeys";
import { markAccountsTiming } from "./accountsTiming";

function amountsDiffer(a: string | null, b: string | null): boolean {
  if (a == null || b == null) return false;
  const na = parseFloat(a);
  const nb = parseFloat(b);
  if (!Number.isFinite(na) || !Number.isFinite(nb)) return false;
  return Math.abs(na - nb) >= 0.005;
}

function mergeAccountIntoEnrichedListCache(
  queryClient: ReturnType<typeof useQueryClient>,
  forecastDays: OperationalForecastDays,
  account: Account
): void {
  const key = accountQueryKeys.enrichedList(forecastDays);
  const existing = queryClient.getQueryData<PaginatedResponse<Account>>(key);
  if (!existing?.results) {
    queryClient.setQueryData(key, {
      count: 1,
      next: null,
      previous: null,
      results: [account],
    } satisfies PaginatedResponse<Account>);
    return;
  }
  const idx = existing.results.findIndex((a) => a.id === account.id);
  const results =
    idx >= 0
      ? existing.results.map((a, i) => (i === idx ? { ...a, ...account } : a))
      : [...existing.results, account];
  queryClient.setQueryData(key, { ...existing, results, count: results.length });
}

export function AccountDetailScreen() {
  const theme = useTheme();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { id } = useLocalSearchParams<{ id: string }>();
  const accountId = Number(id);
  const validId = Number.isInteger(accountId) && accountId > 0;
  const { forecastDays, ready } = usePageForecastWindow();
  const today = todayStr();
  const [pullRefreshing, setPullRefreshing] = useState(false);

  useEffect(() => {
    markAccountsTiming("detail-mounted", "detail");
  }, []);

  useEffect(() => {
    if (!validId) return;
    seedBalanceDetailFromListCache(queryClient, accountId, forecastDays);
  }, [validId, accountId, forecastDays, queryClient]);

  const seeded = useMemo(() => {
    if (!validId) return undefined;
    return seedAccountFromListCache(queryClient, accountId, forecastDays);
  }, [queryClient, accountId, forecastDays, validId]);

  // Observe the shared enriched-list cache (Accounts tab owns the fetch).
  const enrichedListQuery = useQuery({
    queryKey: accountQueryKeys.enrichedList(forecastDays),
    queryFn: () =>
      listAccounts({
        balance: "true",
        forecast_summary: "true",
        health: "true",
        days: forecastDays,
        page_size: 500,
        active_only: true,
      }),
    enabled: false,
    staleTime: 60_000,
  });
  const listEnriched = enrichedListQuery.data?.results?.find((a) => a.id === accountId);

  const balanceQuery = useQuery({
    queryKey: accountQueryKeys.balanceDetail(accountId),
    queryFn: () => getAccount(accountId, true),
    enabled: validId,
    placeholderData: seeded,
    staleTime: 30_000,
  });

  const needsForecastFetch =
    validId && ready && !accountHasForecastEnrichment(listEnriched ?? seeded);

  const forecastQuery = useQuery({
    queryKey: ["account", accountId, "forecast", forecastDays],
    queryFn: async () => {
      const account = await getAccount(accountId, true, {
        forecast_summary: true,
        health: true,
        days: forecastDays,
      });
      mergeAccountIntoEnrichedListCache(queryClient, forecastDays, account);
      queryClient.setQueryData(accountQueryKeys.balanceDetail(accountId), account);
      return account;
    },
    enabled: needsForecastFetch,
    staleTime: 60_000,
  });

  const recentQuery = useQuery({
    queryKey: accountQueryKeys.recentPreview(accountId),
    queryFn: () =>
      listTransactions({
        account: accountId,
        date_before: today,
        reconciled: false,
        page_size: ACCOUNT_DETAIL_PREVIEW_LIMIT,
        ordering: "-date,-id",
      }),
    enabled: validId,
  });

  const timelineQueryOptions = useMemo(
    () =>
      defaultLedgerTimelineQueryOptions({
        accountId,
        forecastDays: ready ? forecastDays : 30,
      }),
    [accountId, forecastDays, ready]
  );

  const upcomingTimelineQuery = useQuery({
    ...timelineQueryOptions,
    enabled: validId && ready,
  });

  const account =
    forecastQuery.data ??
    listEnriched ??
    (accountHasForecastEnrichment(seeded) ? seeded : undefined) ??
    balanceQuery.data ??
    seeded;
  const balances = account ? resolveAccountBalanceDisplay(account) : null;
  const targetUtil = parseFloat(
    account?.target_utilization_percent ?? String(DEFAULT_TARGET_UTILIZATION_PERCENT)
  );

  const previewRows = useMemo(() => {
    const recent = (recentQuery.data?.results ?? []).slice(0, ACCOUNT_DETAIL_PREVIEW_LIMIT);
    const upcoming = accountDetailUpcomingPreviewRows(
      upcomingTimelineQuery.data?.timeline,
      accountId,
      today,
      ACCOUNT_DETAIL_PREVIEW_LIMIT
    );
    return { recent, upcoming };
  }, [recentQuery.data, upcomingTimelineQuery.data?.timeline, accountId, today]);

  useEffect(() => {
    if (account) markAccountsTiming("basic-detail-visible", "detail");
  }, [account]);

  useEffect(() => {
    if (accountHasForecastEnrichment(account)) {
      markAccountsTiming("forecast-enrichment-visible", "detail");
    }
  }, [account]);

  useEffect(() => {
    if (recentQuery.isSuccess) markAccountsTiming("recent-preview-visible", "detail");
  }, [recentQuery.isSuccess]);

  useEffect(() => {
    if (upcomingTimelineQuery.isSuccess) markAccountsTiming("upcoming-preview-visible", "detail");
  }, [upcomingTimelineQuery.isSuccess]);

  const refreshDetail = useCallback(async () => {
    setPullRefreshing(true);
    try {
      await Promise.all([
        balanceQuery.refetch(),
        needsForecastFetch ? forecastQuery.refetch() : Promise.resolve(),
        recentQuery.refetch(),
        upcomingTimelineQuery.refetch(),
      ]);
    } finally {
      setPullRefreshing(false);
    }
  }, [balanceQuery, forecastQuery, needsForecastFetch, recentQuery, upcomingTimelineQuery]);

  const openLedger = () => {
    if (!account) return;
    rememberTransactionAccountSelection(account.id);
    router.push(
      transactionsForAccountPath(account.id, getEffectiveDisplayName(account)) as never
    );
  };

  if (!account && balanceQuery.isLoading) {
    return (
      <Screen scroll>
        <AppHeader title="Account" onBack={() => router.back()} />
        <SkeletonBlock lines={4} />
      </Screen>
    );
  }

  if (!account && (balanceQuery.isError || forecastQuery.isError)) {
    return (
      <Screen scroll>
        <AppHeader title="Account" onBack={() => router.back()} />
        <ErrorState
          message={describeApiError(balanceQuery.error ?? forecastQuery.error)}
          onRetry={() => {
            void balanceQuery.refetch();
            void forecastQuery.refetch();
          }}
        />
      </Screen>
    );
  }

  if (!account) {
    return (
      <Screen scroll>
        <AppHeader title="Account" onBack={() => router.back()} />
        <ErrorState message="Account not found." onRetry={() => void balanceQuery.refetch()} />
      </Screen>
    );
  }

  const forecastLoading =
    needsForecastFetch && forecastQuery.isFetching && !accountHasForecastEnrichment(account);

  return (
    <Screen
      scroll
      scrollProps={{
        refreshControl: (
          <RefreshControl
            refreshing={pullRefreshing}
            onRefresh={() => void refreshDetail()}
            tintColor={theme.colors.tint}
          />
        ),
      }}
    >
      <AppHeader title={getEffectiveDisplayName(account)} onBack={() => router.back()} />

      <Card>
        <Text style={{ color: theme.colors.textMuted, ...theme.typography.caption }}>
          {getAccountInstitutionSubtitle(account)}
        </Text>
        {balances?.kind === "credit" ? (
          <>
            <Text style={{ color: theme.colors.text, ...theme.typography.metric, marginTop: 8 }}>
              {balances.owed != null ? formatCurrency(balances.owed, account.currency) : "—"}
            </Text>
            <Text style={{ color: theme.colors.textMuted, ...theme.typography.caption }}>Owed</Text>
            {balances.availableCredit != null ? (
              <Text style={{ color: theme.colors.textSecondary, ...theme.typography.body, marginTop: 8 }}>
                Available credit {formatCurrency(balances.availableCredit, account.currency)}
              </Text>
            ) : null}
            {balances.creditLimit != null ? (
              <Text style={{ color: theme.colors.textSecondary, ...theme.typography.body, marginTop: 4 }}>
                Credit limit {formatCurrency(balances.creditLimit, account.currency)}
              </Text>
            ) : null}
            {balances.utilizationPercent != null ? (
              <View style={{ marginTop: 12 }}>
                <UtilizationDisplay
                  value={balances.utilizationPercent}
                  warnAt={targetUtil}
                  criticalAt={targetUtil * 2}
                  label={`Utilization (target ${Math.round(targetUtil)}%)`}
                />
              </View>
            ) : null}
            {balances.forecastOwed != null && amountsDiffer(balances.owed, balances.forecastOwed) ? (
              <Text style={{ color: theme.colors.textSecondary, ...theme.typography.body, marginTop: 8 }}>
                Forecast owed {formatCurrency(balances.forecastOwed, account.currency)}
              </Text>
            ) : null}
          </>
        ) : balances?.kind === "cash" ? (
          <>
            <Text style={{ color: theme.colors.text, ...theme.typography.metric, marginTop: 8 }}>
              {balances.primary != null ? formatCurrency(balances.primary, account.currency) : "—"}
            </Text>
            <Text style={{ color: theme.colors.textMuted, ...theme.typography.caption }}>
              {balances.primaryLabel}
            </Text>
            {balances.afterPending != null ? (
              <Text style={{ color: theme.colors.textSecondary, ...theme.typography.body, marginTop: 8 }}>
                After pending {formatCurrency(balances.afterPending, account.currency)}
              </Text>
            ) : null}
            {forecastLoading ? (
              <Text style={{ color: theme.colors.textMuted, ...theme.typography.caption, marginTop: 8 }}>
                Loading forecast…
              </Text>
            ) : balances.safeToSpend != null ? (
              <Text style={{ color: theme.colors.textSecondary, ...theme.typography.body, marginTop: 8 }}>
                Safe to spend {formatCurrency(balances.safeToSpend, account.currency)}
              </Text>
            ) : null}
          </>
        ) : null}
      </Card>

      <View style={{ flexDirection: "row", gap: 8, marginTop: theme.spacing.lg }}>
        <View style={{ flex: 1 }}>
          <Button label="View ledger" onPress={openLedger} />
        </View>
        <View style={{ flex: 1 }}>
          <Button
            label="Edit"
            variant="secondary"
            onPress={() => router.push(`/account/edit/${account.id}`)}
          />
        </View>
      </View>
      <View style={{ marginTop: 8 }}>
        <Button
          label="Reconcile account"
          variant="secondary"
          onPress={() => router.push(reconcilePath(account.id) as never)}
        />
      </View>

      <SectionHeader title="Upcoming" />
      {upcomingTimelineQuery.isPending ? (
        <SkeletonBlock lines={2} />
      ) : previewRows.upcoming.length === 0 ? (
        <EmptyState
          title="No upcoming transactions"
          message={`Nothing scheduled in the next ${forecastDays} days.`}
        />
      ) : (
        <>
          {previewRows.upcoming.map((row) => (
            <TransactionRowCard
              key={`upcoming-${row.transaction_id ?? row.date}-${row.description}-${row.amount}`}
              timelineRow={row}
              statusOverride={isPendingExpectedTimelineRow(row, today) ? "Pending" : "Forecast"}
            />
          ))}
          <View style={{ marginTop: 8 }}>
            <Button label="View full ledger" variant="secondary" onPress={openLedger} />
          </View>
        </>
      )}

      <SectionHeader title="Recent" />
      {recentQuery.isPending ? (
        <SkeletonBlock lines={2} />
      ) : previewRows.recent.length === 0 ? (
        <EmptyState title="No recent activity" message="Recent unreconciled transactions will appear here." />
      ) : (
        <>
          {previewRows.recent.map((txn) => (
            <TransactionRowCard key={txn.id} txn={txn} />
          ))}
          <View style={{ marginTop: 8, marginBottom: theme.spacing.lg }}>
            <Button label="View full ledger" variant="secondary" onPress={openLedger} />
          </View>
        </>
      )}
    </Screen>
  );
}
