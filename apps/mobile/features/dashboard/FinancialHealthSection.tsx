import React, { memo } from "react";
import { Pressable, Text, View } from "react-native";
import { useRouter } from "expo-router";
import type { DashboardSummaryFast, DashboardTopSummary, GettingStartedHelpTopic } from "@budget-app/shared";
import { GETTING_STARTED_HELP_LABELS } from "@budget-app/shared";
import {
  BalanceDisplay,
  ErrorState,
  Skeleton,
} from "@/components/ui";
import { useTheme } from "@/theme";
import { FINANCIAL_HEALTH, lowestForecastBalanceLabel } from "./terminology";
import {
  availableCreditSubtitle,
  lowestProjectedCashSubtitle,
} from "./display";

type Props = {
  forecastDays: number;
  data?: DashboardSummaryFast;
  top: DashboardTopSummary | null;
  /** Official Available Cash/Credit tiles pending — not `isFetching` with cached data. */
  balancesLoading: boolean;
  /** Lowest-forecast tile pending — independent of account balances. */
  forecastLoading: boolean;
  error: boolean;
  errorMessage: string;
  onRetry: () => void;
  recalculating?: boolean;
  onHelpPress?: (topic: GettingStartedHelpTopic) => void;
};

function ForecastTileSkeleton() {
  const theme = useTheme();
  return (
    <View
      testID="home-forecast-skeleton"
      style={{
        backgroundColor: theme.colors.surface,
        borderRadius: theme.radius.lg,
        borderWidth: 1,
        borderColor: theme.colors.border,
        padding: theme.spacing.lg,
        flex: 1,
        minWidth: "46%",
        gap: 8,
      }}
    >
      <Skeleton height={12} width="55%" />
      <Skeleton height={28} width="70%" />
      <Skeleton height={12} width="85%" />
    </View>
  );
}

function BalanceTileSkeleton({ fullWidth = false }: { fullWidth?: boolean }) {
  const theme = useTheme();
  return (
    <View
      testID={fullWidth ? "home-credit-skeleton" : "home-balances-skeleton"}
      style={{
        backgroundColor: theme.colors.surface,
        borderRadius: theme.radius.lg,
        borderWidth: 1,
        borderColor: theme.colors.border,
        padding: theme.spacing.lg,
        flex: 1,
        minWidth: fullWidth ? "100%" : "46%",
        gap: 8,
      }}
    >
      <Skeleton height={12} width="55%" />
      <Skeleton height={28} width="70%" />
      <Skeleton height={12} width="85%" />
    </View>
  );
}

export const FinancialHealthSection = memo(function FinancialHealthSection({
  forecastDays,
  data,
  top,
  balancesLoading,
  forecastLoading,
  error,
  errorMessage,
  onRetry,
  recalculating,
  onHelpPress,
}: Props) {
  const theme = useTheme();
  const router = useRouter();

  if (error && !data && !top) {
    return <ErrorState message={errorMessage} onRetry={onRetry} />;
  }

  if (!forecastLoading && !balancesLoading && !data && !top) {
    return null;
  }

  return (
    <View style={{ gap: theme.spacing.md }} testID="home-financial-health">
      {recalculating ? (
        <Text style={{ color: theme.colors.textMuted, ...theme.typography.caption }}>Updating…</Text>
      ) : null}
      <View style={{ flexDirection: "row", gap: theme.spacing.sm }}>
        {forecastLoading || !data ? (
          <ForecastTileSkeleton />
        ) : (
          <View testID="home-forecast-visible" style={{ flex: 1, minWidth: "46%" }}>
            <BalanceDisplay
              label={lowestForecastBalanceLabel(forecastDays)}
              amount={data.lowest_projected_cash?.amount ?? "0"}
              subtitle={
                data.lowest_projected_cash
                  ? lowestProjectedCashSubtitle(data.lowest_projected_cash)
                  : "No cash accounts in window"
              }
              accessibilityHint={FINANCIAL_HEALTH.lowestProjectedCash.help}
              infoAccessibilityLabel={GETTING_STARTED_HELP_LABELS.lowestForecastBalance}
              onInfoPress={onHelpPress ? () => onHelpPress("lowestForecastBalance") : undefined}
            />
          </View>
        )}
        {balancesLoading || !top ? (
          <BalanceTileSkeleton />
        ) : (
          <View testID="home-balances-visible" style={{ flex: 1, minWidth: "46%" }}>
            <BalanceDisplay
              label={FINANCIAL_HEALTH.availableCash.label}
              amount={top.liquid_cash}
              subtitle={FINANCIAL_HEALTH.availableCash.subtitle}
              infoAccessibilityLabel={GETTING_STARTED_HELP_LABELS.availableCash}
              onInfoPress={onHelpPress ? () => onHelpPress("availableCash") : undefined}
            />
          </View>
        )}
      </View>
      {balancesLoading || !top ? (
        <BalanceTileSkeleton fullWidth />
      ) : (
        <Pressable
          onPress={() => router.push("/(app)/(tabs)/accounts")}
          accessibilityRole="button"
          accessibilityLabel="View accounts for available credit"
        >
          <BalanceDisplay
            label={FINANCIAL_HEALTH.availableCredit.label}
            amount={top.available_credit}
            subtitle={availableCreditSubtitle(top.credit_utilization, top.total_credit_limit)}
            fullWidth
          />
        </Pressable>
      )}
    </View>
  );
});
