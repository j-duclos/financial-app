import React, { memo, useMemo } from "react";
import { Text, View } from "react-native";
import { useRouter } from "expo-router";
import {
  buildUpcomingDashboardPreview,
  formatShortMonthDay,
  upcomingTransactionNavTarget,
  type DashboardFirstCashShortfall,
  type DashboardGoalSummary,
  type DashboardUpcomingGroup,
  type DashboardUpcomingTransaction,
} from "@budget-app/shared";
import {
  Card,
  CurrencyDisplay,
  EmptyState,
  ErrorState,
  SectionHeader,
  StatusChip,
} from "@/components/ui";
import { useTheme } from "@/theme";
import { DASHBOARD_SECTION } from "./terminology";
import { calendarDatePath, goalDetailPath, goalsListPath } from "./navigation";
import { DashboardUpcomingRow } from "./DashboardUpcomingRow";
import { DashboardGoalCard } from "./DashboardGoalCard";
import { GoalCardSkeleton, UpcomingPreviewSkeleton } from "./DashboardSkeletons";
import type { DashboardDetailsSectionState } from "./dashboardSectionState";

type UpcomingProps = {
  sectionState: DashboardDetailsSectionState;
  errorMessage: string;
  onRetry: () => void;
  upcomingGroups: DashboardUpcomingGroup[];
  firstCashShortfall?: DashboardFirstCashShortfall | null;
  recalculating?: boolean;
};

export const DashboardUpcomingSection = memo(function DashboardUpcomingSection({
  sectionState,
  errorMessage,
  onRetry,
  upcomingGroups,
  firstCashShortfall,
  recalculating,
}: UpcomingProps) {
  const theme = useTheme();
  const router = useRouter();

  const preview = useMemo(() => {
    const nextIssue = firstCashShortfall?.date
      ? {
          risk_date: firstCashShortfall.date,
          account_name: firstCashShortfall.account_name ?? undefined,
          projected_balance: firstCashShortfall.amount ?? null,
        }
      : undefined;
    return buildUpcomingDashboardPreview(upcomingGroups, nextIssue);
  }, [upcomingGroups, firstCashShortfall]);

  const onTxnPress = (txn: DashboardUpcomingTransaction) => {
    const target = upcomingTransactionNavTarget(txn);
    if (target.type === "transaction") {
      router.push(`/transaction/${target.transactionId}`);
      return;
    }
    router.push(calendarDatePath(target.date));
  };

  if (sectionState === "hidden") {
    return null;
  }

  return (
    <>
      <SectionHeader
        title={DASHBOARD_SECTION.upcoming}
        actionLabel="Calendar"
        onAction={() => router.push("/(app)/(tabs)/calendar")}
        subtitle={recalculating ? "Updating…" : undefined}
      />
      {sectionState === "loading" ? (
        <UpcomingPreviewSkeleton />
      ) : sectionState === "error" ? (
        <ErrorState message={errorMessage} onRetry={onRetry} />
      ) : preview.transactions.length === 0 ? (
        <EmptyState title={`No upcoming transactions in the next ${preview.daysHorizon} days.`} />
      ) : (
        <View style={{ gap: theme.spacing.sm }}>
          {preview.nextRisk ? (
            <Card style={{ backgroundColor: theme.colors.warningBg }}>
              <StatusChip label="First cash shortfall" tone="warning" />
              <View
                style={{
                  flexDirection: "row",
                  justifyContent: "space-between",
                  alignItems: "flex-start",
                  marginTop: 8,
                  gap: 12,
                }}
              >
                <View style={{ flex: 1 }}>
                  {preview.nextRisk.accountName ? (
                    <Text style={{ color: theme.colors.text, ...theme.typography.bodyStrong }}>
                      {preview.nextRisk.accountName}
                    </Text>
                  ) : null}
                  <Text style={{ color: theme.colors.textSecondary, ...theme.typography.body }}>
                    {formatShortMonthDay(preview.nextRisk.date)}
                  </Text>
                </View>
                {preview.nextRisk.projectedEndBalance != null ? (
                  <View style={{ alignItems: "flex-end" }}>
                    <Text style={{ color: theme.colors.textMuted, ...theme.typography.caption }}>
                      Projected balance
                    </Text>
                    <CurrencyDisplay
                      amount={preview.nextRisk.projectedEndBalance}
                      tone="negative"
                      style={{ marginTop: 2 }}
                    />
                  </View>
                ) : null}
              </View>
            </Card>
          ) : null}

          {preview.truncated && preview.truncatedMessage ? (
            <Text
              style={{
                color: theme.colors.textMuted,
                ...theme.typography.caption,
                marginBottom: theme.spacing.xs,
              }}
            >
              {preview.truncatedMessage}
            </Text>
          ) : null}

          <Card style={{ padding: 0, overflow: "hidden" }}>
            {preview.transactions.map(({ txn, isFirstZeroCross }, index) => (
              <DashboardUpcomingRow
                key={txn.id}
                txn={txn}
                isFirstZeroCross={isFirstZeroCross}
                showDivider={index > 0}
                onPress={() => onTxnPress(txn)}
              />
            ))}
          </Card>

          {preview.anyTransfers ? (
            <Text style={{ color: theme.colors.textMuted, ...theme.typography.caption }}>
              Transfers move money between your accounts and do not change household cash flow.
            </Text>
          ) : null}
        </View>
      )}
    </>
  );
});

type GoalsProps = {
  sectionState: DashboardDetailsSectionState;
  errorMessage: string;
  onRetry: () => void;
  goals: DashboardGoalSummary[];
  recalculating?: boolean;
};

export const DashboardGoalsSection = memo(function DashboardGoalsSection({
  sectionState,
  errorMessage,
  onRetry,
  goals,
  recalculating,
}: GoalsProps) {
  const theme = useTheme();
  const router = useRouter();

  if (sectionState === "hidden") {
    return null;
  }

  return (
    <>
      <SectionHeader
        title={DASHBOARD_SECTION.goals}
        actionLabel="All goals"
        onAction={() => router.push(goalsListPath())}
        subtitle={recalculating ? "Updating…" : undefined}
      />
      {sectionState === "loading" ? (
        <GoalCardSkeleton />
      ) : sectionState === "error" ? (
        <ErrorState message={errorMessage} onRetry={onRetry} />
      ) : goals.length === 0 ? (
        <EmptyState
          title="No goals yet"
          message="Create a savings or debt goal to track progress here."
          actionLabel="Goals"
          onAction={() => router.push(goalsListPath())}
        />
      ) : (
        <View style={{ gap: theme.spacing.sm, marginBottom: theme.spacing.xl }}>
          {goals.map((goal) => (
            <DashboardGoalCard
              key={goal.id}
              goal={goal}
              onPress={() => router.push(goalDetailPath(goal.id))}
            />
          ))}
        </View>
      )}
    </>
  );
});
