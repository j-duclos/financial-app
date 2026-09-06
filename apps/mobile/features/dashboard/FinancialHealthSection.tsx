import React, { memo } from "react";
import { Pressable, Text, View } from "react-native";
import { useRouter } from "expo-router";
import type { DashboardSummaryFast, DashboardTopSummary } from "@budget-app/shared";
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
  loading: boolean;
  error: boolean;
  errorMessage: string;
  onRetry: () => void;
  recalculating?: boolean;
};

function FinancialHealthSkeleton() {
  const theme = useTheme();
  const tile = (key: string, fullWidth = false) => (
    <View
      key={key}
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

  return (
    <View style={{ gap: theme.spacing.md }}>
      <View style={{ flexDirection: "row", gap: theme.spacing.sm }}>
        {tile("lowest")}
        {tile("cash")}
      </View>
      {tile("credit", true)}
    </View>
  );
}

export const FinancialHealthSection = memo(function FinancialHealthSection({
  forecastDays,
  data,
  top,
  loading,
  error,
  errorMessage,
  onRetry,
  recalculating,
}: Props) {
  const theme = useTheme();
  const router = useRouter();

  if (loading) {
    return <FinancialHealthSkeleton />;
  }

  if (error && !data) {
    return <ErrorState message={errorMessage} onRetry={onRetry} />;
  }

  if (!data || !top) {
    return null;
  }

  return (
    <View style={{ gap: theme.spacing.md }}>
      {recalculating ? (
        <Text style={{ color: theme.colors.textMuted, ...theme.typography.caption }}>Updating…</Text>
      ) : null}
      <View style={{ flexDirection: "row", gap: theme.spacing.sm }}>
        <BalanceDisplay
          label={lowestForecastBalanceLabel(forecastDays)}
          amount={data.lowest_projected_cash?.amount ?? "0"}
          subtitle={
            data.lowest_projected_cash
              ? lowestProjectedCashSubtitle(data.lowest_projected_cash)
              : "No cash accounts in window"
          }
          accessibilityHint={FINANCIAL_HEALTH.lowestProjectedCash.help}
        />
        <BalanceDisplay
          label={FINANCIAL_HEALTH.availableCash.label}
          amount={top.liquid_cash}
          subtitle={FINANCIAL_HEALTH.availableCash.subtitle}
        />
      </View>
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
    </View>
  );
});
