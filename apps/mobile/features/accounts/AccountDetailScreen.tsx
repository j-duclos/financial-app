import React, { useMemo } from "react";
import { RefreshControl, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { getAccount, listTransactions } from "@budget-app/api-client";
import {
  DEFAULT_TARGET_UTILIZATION_PERCENT,
  formatCurrency,
  getAccountInstitutionSubtitle,
  getEffectiveDisplayName,
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
import { ledgerProjectionRange } from "@/lib/transactionsLedger";
import { TransactionRowCard } from "@/features/transactions/TransactionRowCard";

export function AccountDetailScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const accountId = Number(id);
  const { forecastDays, ready } = usePageForecastWindow();
  const projection = ledgerProjectionRange(ready ? forecastDays : 30);

  const accountQuery = useQuery({
    queryKey: ["account", accountId, "detail", forecastDays],
    queryFn: () =>
      getAccount(accountId, true, {
        forecast_summary: true,
        health: true,
        days: forecastDays,
        relationships: true,
      }),
    enabled: Number.isInteger(accountId) && accountId > 0 && ready,
  });

  const recentQuery = useQuery({
    queryKey: ["transactions", "account-preview", accountId],
    queryFn: () =>
      listTransactions({
        account: accountId,
        date_before: todayStr(),
        reconciled: false,
        page_size: 8,
      }),
    enabled: Number.isInteger(accountId) && accountId > 0,
  });

  const upcomingQuery = useQuery({
    queryKey: ["transactions", "account-upcoming", accountId, projection.end],
    queryFn: () =>
      listTransactions({
        account: accountId,
        date_after: todayStr(),
        date_before: projection.end,
        page_size: 8,
      }),
    enabled: Number.isInteger(accountId) && accountId > 0,
  });

  const account = accountQuery.data;
  const isCredit = account?.account_type === "CREDIT";
  const targetUtil = parseFloat(
    account?.target_utilization_percent ?? String(DEFAULT_TARGET_UTILIZATION_PERCENT)
  );

  const previewRows = useMemo(() => {
    const recent = recentQuery.data?.results ?? [];
    const upcoming = upcomingQuery.data?.results ?? [];
    return { recent, upcoming };
  }, [recentQuery.data, upcomingQuery.data]);

  if (accountQuery.isLoading) {
    return (
      <Screen scroll>
        <AppHeader title="Account" onBack={() => router.back()} />
        <SkeletonBlock lines={4} />
      </Screen>
    );
  }

  if (accountQuery.isError || !account) {
    return (
      <Screen scroll>
        <AppHeader title="Account" onBack={() => router.back()} />
        <ErrorState message={describeApiError(accountQuery.error)} onRetry={() => void accountQuery.refetch()} />
      </Screen>
    );
  }

  return (
    <Screen
      scroll
      scrollProps={{
        refreshControl: (
          <RefreshControl
            refreshing={accountQuery.isFetching && !accountQuery.isPending}
            onRefresh={() => {
              void accountQuery.refetch();
              void recentQuery.refetch();
              void upcomingQuery.refetch();
            }}
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
        {isCredit ? (
          <>
            <Text style={{ color: theme.colors.text, ...theme.typography.metric, marginTop: 8 }}>
              {account.balance_owed != null ? formatCurrency(account.balance_owed, account.currency) : "—"}
            </Text>
            <Text style={{ color: theme.colors.textMuted, ...theme.typography.caption }}>Balance owed</Text>
            {account.credit_limit ? (
              <Text style={{ color: theme.colors.textSecondary, ...theme.typography.body, marginTop: 8 }}>
                Limit {formatCurrency(account.credit_limit, account.currency)}
              </Text>
            ) : null}
            {account.utilization_percent != null ? (
              <View style={{ marginTop: 12 }}>
                <UtilizationDisplay
                  value={account.utilization_percent}
                  warnAt={targetUtil}
                  criticalAt={targetUtil * 2}
                  label={`Utilization (target ${Math.round(targetUtil)}%)`}
                />
              </View>
            ) : null}
          </>
        ) : (
          <>
            <Text style={{ color: theme.colors.text, ...theme.typography.metric, marginTop: 8 }}>
              {account.available_balance != null
                ? formatCurrency(account.available_balance, account.currency)
                : "—"}
            </Text>
            <Text style={{ color: theme.colors.textMuted, ...theme.typography.caption }}>Available balance</Text>
          </>
        )}
        {account.available_to_spend != null ? (
          <Text style={{ color: theme.colors.textSecondary, ...theme.typography.body, marginTop: 8 }}>
            Safe to spend {formatCurrency(account.available_to_spend, account.currency)}
          </Text>
        ) : null}
        {account.projected_balance_30_days != null && isCredit ? (
          <Text style={{ color: theme.colors.textSecondary, ...theme.typography.body, marginTop: 4 }}>
            Forecast owed {formatCurrency(account.projected_balance_30_days, account.currency)}
          </Text>
        ) : null}
      </Card>

      <View style={{ flexDirection: "row", gap: 8, marginTop: theme.spacing.lg }}>
        <View style={{ flex: 1 }}>
          <Button label="View transactions" onPress={() => router.push({ pathname: "/(app)/(tabs)/transactions", params: { account: String(account.id) } })} />
        </View>
        <View style={{ flex: 1 }}>
          <Button label="Edit" variant="secondary" onPress={() => router.push(`/account/edit/${account.id}`)} />
        </View>
      </View>

      <SectionHeader title="Upcoming" />
      {previewRows.upcoming.length === 0 ? (
        <EmptyState title="No upcoming transactions" message={`Nothing scheduled in the next ${forecastDays} days.`} />
      ) : (
        previewRows.upcoming.map((txn) => (
          <TransactionRowCard key={txn.id} txn={txn} showAccount={false} />
        ))
      )}

      <SectionHeader title="Recent" />
      {previewRows.recent.length === 0 ? (
        <EmptyState title="No recent activity" message="Recent unreconciled transactions will appear here." />
      ) : (
        previewRows.recent.map((txn) => (
          <TransactionRowCard key={txn.id} txn={txn} showAccount={false} />
        ))
      )}
    </Screen>
  );
}
