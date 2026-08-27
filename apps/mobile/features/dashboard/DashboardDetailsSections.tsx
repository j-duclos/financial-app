import React, { memo } from "react";
import { Text, View } from "react-native";
import { useRouter } from "expo-router";
import { formatCurrency } from "@budget-app/shared";
import type { DashboardGoalSummary, DashboardUpcomingGroup } from "@budget-app/shared";
import { Card, CurrencyDisplay, EmptyState, ErrorState, SectionHeader, SkeletonBlock, StatusChip } from "@/components/ui";
import { useTheme } from "@/theme";
import { DASHBOARD_SECTION } from "./terminology";

type UpcomingProps = {
  loading: boolean;
  error: boolean;
  errorMessage: string;
  onRetry: () => void;
  upcomingGroups: DashboardUpcomingGroup[];
  firstCashShortfall?: {
    date?: string;
    account_name?: string;
    amount?: string | null;
  } | null;
};

export const DashboardUpcomingSection = memo(function DashboardUpcomingSection({
  loading,
  error,
  errorMessage,
  onRetry,
  upcomingGroups,
  firstCashShortfall,
}: UpcomingProps) {
  const theme = useTheme();
  const router = useRouter();

  return (
    <>
      <SectionHeader
        title={DASHBOARD_SECTION.upcoming}
        actionLabel="Calendar"
        onAction={() => router.push("/calendar")}
      />
      {loading ? (
        <Card>
          <SkeletonBlock lines={4} />
        </Card>
      ) : error ? (
        <ErrorState message={errorMessage} onRetry={onRetry} />
      ) : upcomingGroups.length === 0 ? (
        <EmptyState title="No upcoming money movement in this window." />
      ) : (
        <View style={{ gap: theme.spacing.sm }}>
          {firstCashShortfall?.date ? (
            <Card style={{ backgroundColor: theme.colors.criticalBg }}>
              <StatusChip label="First cash shortfall" tone="critical" />
              <Text style={{ color: theme.colors.text, marginTop: 8, ...theme.typography.body }}>
                {firstCashShortfall.account_name} on {firstCashShortfall.date}
              </Text>
              {firstCashShortfall.amount != null ? (
                <CurrencyDisplay
                  amount={firstCashShortfall.amount}
                  tone="negative"
                  style={{ marginTop: 6 }}
                />
              ) : null}
            </Card>
          ) : null}
          {upcomingGroups.map((group) => (
            <Card key={group.date} onPress={() => router.push("/calendar")}>
              <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                <Text style={{ color: theme.colors.text, ...theme.typography.bodyStrong }}>
                  {group.label}
                </Text>
                <Text style={{ color: theme.colors.textMuted, ...theme.typography.caption }}>
                  {group.day_of_week}
                </Text>
              </View>
              <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 8 }}>
                <Text style={{ color: theme.colors.moneyPositive, ...theme.typography.caption }}>
                  In {formatCurrency(group.income_total)}
                </Text>
                <Text style={{ color: theme.colors.moneyNegative, ...theme.typography.caption }}>
                  Out {formatCurrency(group.expense_total)}
                </Text>
                <CurrencyDisplay amount={group.net_total} style={{ fontSize: 14 }} />
              </View>
              {group.has_risk ? (
                <Text style={{ color: theme.colors.critical, ...theme.typography.caption, marginTop: 6 }}>
                  {group.risk_reason || "Risk day"}
                </Text>
              ) : null}
            </Card>
          ))}
        </View>
      )}
    </>
  );
});

type GoalsProps = {
  loading: boolean;
  goals: DashboardGoalSummary[];
};

export const DashboardGoalsSection = memo(function DashboardGoalsSection({ loading, goals }: GoalsProps) {
  const theme = useTheme();
  const router = useRouter();

  return (
    <>
      <SectionHeader
        title={DASHBOARD_SECTION.goals}
        actionLabel="All goals"
        onAction={() => router.push("/goals")}
      />
      {loading ? (
        <Card>
          <SkeletonBlock lines={3} />
        </Card>
      ) : goals.length === 0 ? (
        <EmptyState
          title="No goals yet"
          message="Create a savings or debt goal to track progress here."
          actionLabel="Goals"
          onAction={() => router.push("/goals")}
        />
      ) : (
        <View style={{ gap: theme.spacing.sm, marginBottom: theme.spacing.xl }}>
          {goals.map((goal) => (
            <Card key={goal.id} onPress={() => router.push("/goals")}>
              <Text style={{ color: theme.colors.text, ...theme.typography.bodyStrong }}>{goal.name}</Text>
              <Text style={{ color: theme.colors.textMuted, ...theme.typography.caption, marginTop: 4 }}>
                {formatCurrency(goal.current_amount)} of {formatCurrency(goal.target_amount)} ·{" "}
                {parseFloat(goal.progress_percent).toFixed(0)}%
              </Text>
              {goal.contribution_recommendation || goal.recommended_monthly_contribution ? (
                <Text style={{ color: theme.colors.textSecondary, ...theme.typography.caption, marginTop: 6 }}>
                  {goal.contribution_recommendation ||
                    `Suggested ${formatCurrency(goal.recommended_monthly_contribution!)}/mo`}
                </Text>
              ) : null}
            </Card>
          ))}
        </View>
      )}
    </>
  );
});
