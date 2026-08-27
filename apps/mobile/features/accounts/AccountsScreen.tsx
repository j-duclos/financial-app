import React, { useMemo } from "react";
import { RefreshControl, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { EmptyState, ErrorState, IconButton, Screen, SectionHeader, SkeletonBlock } from "@/components/ui";
import { useTheme } from "@/theme";
import { groupAccountsByType } from "@/lib/accountGroups";
import { usePageForecastWindow } from "@/hooks/usePageForecastWindow";
import { describeApiError } from "@/services/api";
import { useAccountsList } from "./useAccountsList";
import { AccountRow } from "./AccountRow";

export function AccountsScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { forecastDays, ready } = usePageForecastWindow();
  const { accounts, isLoading, isError, error, refetch, isEnriching } = useAccountsList(
    forecastDays,
    { forecastReady: ready }
  );

  const groups = useMemo(() => groupAccountsByType(accounts), [accounts]);

  return (
    <Screen
      scroll
      scrollProps={{
        refreshControl: (
          <RefreshControl refreshing={isEnriching} onRefresh={() => refetch()} tintColor={theme.colors.tint} />
        ),
      }}
    >
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        <Text style={{ color: theme.colors.text, ...theme.typography.title }}>Accounts</Text>
        <IconButton
          name="plus"
          accessibilityLabel="Add account"
          onPress={() => router.push("/account/new")}
        />
      </View>

      {isLoading ? (
        <View style={{ gap: 8, marginTop: theme.spacing.lg }}>
          <SkeletonBlock lines={3} />
          <SkeletonBlock lines={3} />
        </View>
      ) : isError ? (
        <ErrorState message={describeApiError(error)} onRetry={() => refetch()} />
      ) : accounts.length === 0 ? (
        <EmptyState
          title="No accounts yet"
          message="Add your first account to start tracking balances and transactions."
          actionLabel="Add account"
          onAction={() => router.push("/account/new")}
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
