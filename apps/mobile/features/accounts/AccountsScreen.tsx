import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, RefreshControl, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import {
  EmptyState,
  ErrorState,
  AppHeader,
  IconButton,
  Screen,
  SectionHeader,
  SkeletonBlock,
  StatusChip,
} from "@/components/ui";
import { useTheme } from "@/theme";
import { groupAccountsByType } from "@/lib/accountGroups";
import { usePageForecastWindow } from "@/hooks/usePageForecastWindow";
import { describeApiError } from "@/services/api";
import { useAccountsList } from "./useAccountsList";
import { AccountRow } from "./AccountRow";
import { markAccountsTiming } from "./accountsTiming";

export function AccountsScreen() {
  const theme = useTheme();
  const router = useRouter();
  const params = useLocalSearchParams<{ attention?: string }>();
  const attentionFilterActive = params.attention === "1";
  const { forecastDays, ready } = usePageForecastWindow();
  const { accounts, isLoading, isError, error, refetch, isEnriching } = useAccountsList(
    forecastDays,
    { forecastReady: ready }
  );

  const [pullRefreshing, setPullRefreshing] = useState(false);

  const refreshAccounts = useCallback(async () => {
    setPullRefreshing(true);
    try {
      await refetch();
    } finally {
      setPullRefreshing(false);
    }
  }, [refetch]);

  useEffect(() => {
    markAccountsTiming("accounts-mounted", "list");
  }, []);

  useEffect(() => {
    if (accounts.length > 0) markAccountsTiming("basic-account-data-visible", "list");
  }, [accounts.length]);

  useEffect(() => {
    if (!isEnriching && accounts.some((a) => a.health_status != null || a.risk_status != null)) {
      markAccountsTiming("enriched-statuses-visible", "list");
    }
  }, [isEnriching, accounts]);

  const visibleAccounts = useMemo(() => {
    if (!attentionFilterActive) return accounts;
    return accounts.filter((account) => {
      const status = account.health_status ?? account.risk_status;
      return status === "watch" || status === "risk" || status === "critical";
    });
  }, [accounts, attentionFilterActive]);

  const groups = useMemo(() => groupAccountsByType(visibleAccounts), [visibleAccounts]);

  return (
    <Screen
      scroll
      scrollProps={{
        refreshControl: (
          <RefreshControl
            refreshing={pullRefreshing}
            onRefresh={() => void refreshAccounts()}
            tintColor={theme.colors.tint}
          />
        ),
      }}
    >
      <AppHeader
        title="Accounts"
        right={
          <IconButton
            name="plus"
            accessibilityLabel="Add account"
            onPress={() => router.push("/account/new")}
          />
        }
      />

      {attentionFilterActive ? (
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            marginTop: theme.spacing.md,
            gap: 8,
          }}
        >
          <StatusChip label="Needs attention" tone="warning" />
          <Pressable
            onPress={() => router.replace("/(app)/(tabs)/accounts")}
            accessibilityRole="button"
            accessibilityLabel="Clear attention filter"
          >
            <Text style={{ color: theme.colors.tint, fontWeight: "600" }}>Clear filter</Text>
          </Pressable>
        </View>
      ) : null}

      {isLoading ? (
        <View style={{ gap: 8, marginTop: theme.spacing.lg }}>
          <SkeletonBlock lines={3} />
          <SkeletonBlock lines={3} />
        </View>
      ) : isError ? (
        <ErrorState message={describeApiError(error)} onRetry={() => refetch()} />
      ) : visibleAccounts.length === 0 ? (
        <EmptyState
          title={attentionFilterActive ? "No accounts need attention" : "No accounts yet"}
          message={
            attentionFilterActive
              ? "All accounts look healthy in the current forecast window."
              : "Add your first account to start tracking balances and transactions."
          }
          actionLabel={attentionFilterActive ? "Clear filter" : "Add account"}
          onAction={() =>
            attentionFilterActive
              ? router.replace("/(app)/(tabs)/accounts")
              : router.push("/account/new")
          }
        />
      ) : (
        <View style={{ marginTop: theme.spacing.md }}>
          {groups.map((group) => (
            <View key={group.key}>
              <SectionHeader title={group.label} subtitle={`${group.accounts.length} accounts`} />
              {group.accounts.map((account) => (
                <AccountRow
                  key={account.id}
                  account={account}
                  onPress={() => router.push(`/account/${account.id}`)}
                />
              ))}
            </View>
          ))}
        </View>
      )}
    </Screen>
  );
}
