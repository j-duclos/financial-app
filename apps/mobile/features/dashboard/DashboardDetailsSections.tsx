import React, { memo, useMemo } from "react";
import { Pressable, Text, View } from "react-native";
import { useRouter } from "expo-router";
import FontAwesome from "@expo/vector-icons/FontAwesome";
import {
  buildUpcomingDashboardPreview,
  formatShortMonthDay,
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
import { firstCashShortfallTapDestination, goalDetailPath, goalsListPath, upcomingMoneyFlowRowDestination } from "./navigation";
import { markAttentionNavigation } from "./attentionNavigationTiming";
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
          first_negative_transaction_id: firstCashShortfall.first_negative_transaction_id ?? null,
        }
      : undefined;
    return buildUpcomingDashboardPreview(upcomingGroups, nextIssue);
  }, [upcomingGroups, firstCashShortfall]);

  const shortfallDestination = useMemo(
    () => (firstCashShortfall ? firstCashShortfallTapDestination(firstCashShortfall) : null),
    [firstCashShortfall]
  );

  const onTxnPress = (txn: DashboardUpcomingTransaction) => {
    markAttentionNavigation("attention-tap");
    router.push(upcomingMoneyFlowRowDestination(txn) as never);
    markAttentionNavigation("navigation-started");
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
            <Pressable
              onPress={() => {
                if (!shortfallDestination) return;
                markAttentionNavigation("attention-tap");
                router.push(shortfallDestination as never);
                markAttentionNavigation("navigation-started");
              }}
              disabled={!shortfallDestination}
              accessibilityRole="button"
              accessibilityLabel="First cash shortfall. Opens account transactions at the forecast risk."
              style={({ pressed }) => ({ opacity: pressed ? 0.88 : 1 })}
            >
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
                  <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 8 }}>
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
                    {shortfallDestination ? (
                      <FontAwesome
                        name="chevron-right"
                        size={12}
                        color={theme.colors.textMuted}
                        style={{ marginTop: 4 }}
                        accessibilityElementsHidden
                      />
                    ) : null}
                  </View>
                </View>
              </Card>
            </Pressable>
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
                shortfallAccountName={preview.nextRisk?.accountName}
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
