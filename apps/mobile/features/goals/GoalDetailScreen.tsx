import React, { useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { formatCurrency, formatShortMonthDay } from "@budget-app/shared";
import {
  formatGoalTargetDate,
  goalDetailAdvancedForecastRows,
  goalDetailForecastRows,
  goalDetailPrimaryPaceLines,
  goalDetailProgressLine,
  goalLinkedAccountId,
  goalLinkedAccountName,
  goalListStatusDisplay,
  goalPrimaryRecommendation,
  parseProgressPercent,
} from "@budget-app/shared";
import {
  archiveBucket,
  completeBucket,
  deleteBucket,
  duplicateBucket,
  getBucketDetail,
  getBucketsOverview,
  pauseBucket,
} from "@budget-app/api-client";
import {
  AppHeader,
  Card,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  IconButton,
  Screen,
  SkeletonBlock,
  StatusChip,
} from "@/components/ui";
import { useTheme } from "@/theme";
import { useDefaultHouseholdId } from "@/hooks/useDefaultHouseholdId";
import { describeApiError } from "@/services/api";
import { GoalProgressBar } from "./GoalProgressBar";
import { GoalActionsSheet, type GoalActionId } from "./GoalActionsSheet";
import {
  goalAccountPath,
  goalContributionHistoryPath,
  goalDetailPath,
  goalEditPath,
  goalRelatedTransactionsPath,
  goalWhatIfPath,
  goalsListPath,
} from "./navigation";
import {
  GOAL_DETAIL_HISTORY_PREVIEW_LIMIT,
  goalsQueryKeys,
  invalidateGoalsQueries,
} from "./queryKeys";

function ForecastRow({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "shortfall" | "surplus";
}) {
  const theme = useTheme();
  return (
    <View
      style={{
        flexDirection: "row",
        justifyContent: "space-between",
        paddingVertical: 6,
        borderBottomWidth: 1,
        borderBottomColor: theme.colors.border,
      }}
    >
      <Text style={{ color: theme.colors.textMuted, ...theme.typography.caption }}>{label}</Text>
      <Text
        style={{
          color:
            tone === "shortfall"
              ? theme.colors.warning
              : tone === "surplus"
                ? theme.colors.moneyPositive
                : theme.colors.text,
          fontWeight: "600",
        }}
      >
        {value}
      </Text>
    </View>
  );
}

function NavRow({
  title,
  subtitle,
  onPress,
}: {
  title: string;
  subtitle?: string | null;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={title}
      style={({ pressed }) => ({
        opacity: pressed ? 0.75 : 1,
        flexDirection: "row",
        alignItems: "center",
        paddingVertical: 4,
      })}
    >
      <View style={{ flex: 1 }}>
        <Text style={{ color: theme.colors.text, ...theme.typography.bodyStrong }}>{title}</Text>
        {subtitle ? (
          <Text style={{ color: theme.colors.textMuted, ...theme.typography.caption, marginTop: 2 }}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      <Text style={{ color: theme.colors.textMuted, fontSize: 18 }}>›</Text>
    </Pressable>
  );
}

export function GoalDetailScreen() {
  const theme = useTheme();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { householdId } = useDefaultHouseholdId();
  const { id } = useLocalSearchParams<{ id: string }>();
  const goalId = Number(id);
  const [actionsOpen, setActionsOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [forecastExpanded, setForecastExpanded] = useState(false);

  const overviewQuery = useQuery({
    queryKey: goalsQueryKeys.overview(householdId),
    queryFn: () => getBucketsOverview({ household: householdId! }),
    enabled: householdId != null,
  });

  const overviewGoal = useMemo(
    () => overviewQuery.data?.goals.find((g) => g.id === goalId) ?? null,
    [overviewQuery.data, goalId]
  );

  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: goalsQueryKeys.detail(goalId),
    queryFn: () =>
      getBucketDetail(goalId, { history_limit: GOAL_DETAIL_HISTORY_PREVIEW_LIMIT }),
    enabled: Number.isInteger(goalId) && goalId > 0,
    placeholderData: overviewGoal
      ? {
          goal: overviewGoal,
          contribution_history: [],
          linked_rules: [],
          forecast_growth: [],
          forecast_scenarios: [],
        }
      : undefined,
  });

  const goal = data?.goal ?? overviewGoal;
  const history = data?.contribution_history ?? [];
  const recentHistory = history.slice(0, GOAL_DETAIL_HISTORY_PREVIEW_LIMIT);
  const pct = goal ? parseProgressPercent(goal.progress_percent) : 0;
  const status = goal ? goalListStatusDisplay(goal) : null;
  const forecastRows = goal ? goalDetailForecastRows(goal) : [];
  const advancedRows = goal ? goalDetailAdvancedForecastRows(goal) : [];
  const recommendation = goal ? goalPrimaryRecommendation(goal) : null;
  const paceLines = goal ? goalDetailPrimaryPaceLines(goal) : { needed: null, pace: null };
  const targetDate = goal ? formatGoalTargetDate(goal.target_date) : null;
  const projectedDate = goal ? formatGoalTargetDate(goal.projected_completion_date) : null;
  const linkedAccountId = goal ? goalLinkedAccountId(goal) : null;
  const linkedAccountName = goal ? goalLinkedAccountName(goal) : null;

  const invalidate = () => invalidateGoalsQueries(queryClient);
  const pauseMu = useMutation({ mutationFn: pauseBucket, onSuccess: invalidate });
  const completeMu = useMutation({ mutationFn: completeBucket, onSuccess: invalidate });
  const archiveMu = useMutation({ mutationFn: archiveBucket, onSuccess: invalidate });
  const duplicateMu = useMutation({
    mutationFn: duplicateBucket,
    onSuccess: (g) => {
      invalidate();
      router.replace(goalDetailPath(g.id));
    },
  });
  const deleteMu = useMutation({
    mutationFn: deleteBucket,
    onSuccess: () => {
      invalidate();
      router.replace(goalsListPath());
    },
  });

  const onAction = (action: GoalActionId) => {
    if (!goal) return;
    setActionsOpen(false);
    switch (action) {
      case "edit":
        router.push(goalEditPath(goal.id));
        break;
      case "what-if":
        router.push(goalWhatIfPath(goal.id));
        break;
      case "duplicate":
        duplicateMu.mutate(goal.id);
        break;
      case "pause":
        pauseMu.mutate(goal.id);
        break;
      case "complete":
        completeMu.mutate(goal.id);
        break;
      case "archive":
        archiveMu.mutate(goal.id);
        break;
      case "delete":
        setDeleteOpen(true);
        break;
      default:
        break;
    }
  };

  if (!Number.isInteger(goalId) || goalId <= 0) {
    return (
      <Screen scroll={false}>
        <EmptyState title="Invalid goal" message="This goal link is not valid." />
      </Screen>
    );
  }

  const showInitialSkeleton = isLoading && !goal;

  return (
    <Screen scroll>
      <AppHeader
        title={goal?.name ?? "Goal"}
        onBack={() => router.push(goalsListPath())}
        right={
          goal ? (
            <IconButton
              name="ellipsis-v"
              accessibilityLabel="Goal actions"
              onPress={() => setActionsOpen(true)}
            />
          ) : null
        }
      />

      {showInitialSkeleton ? (
        <SkeletonBlock lines={10} />
      ) : isError && !goal ? (
        <ErrorState message={describeApiError(error)} onRetry={() => refetch()} />
      ) : !goal ? (
        <EmptyState title="Goal not found" message="This goal may have been deleted." />
      ) : (
        <View style={{ gap: theme.spacing.md }}>
          {isFetching && !isLoading ? (
            <Text style={{ color: theme.colors.textMuted, ...theme.typography.caption }}>
              Updating…
            </Text>
          ) : null}

          <Card>
            <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 8 }}>
              {status ? <StatusChip label={status.label} tone={status.tone} /> : <View />}
            </View>

            <View style={{ marginTop: 12 }}>
              <GoalProgressBar percent={pct} />
            </View>

            <Text
              style={{
                color: theme.colors.text,
                ...theme.typography.bodyStrong,
                marginTop: 10,
              }}
            >
              {goalDetailProgressLine(goal)}
            </Text>
            <Text style={{ color: theme.colors.textMuted, ...theme.typography.caption }}>
              {pct.toFixed(pct % 1 === 0 ? 0 : 2)}% complete
            </Text>

            {targetDate ? (
              <Text style={{ color: theme.colors.textSecondary, ...theme.typography.caption, marginTop: 10 }}>
                Target {targetDate}
              </Text>
            ) : null}
            {projectedDate ? (
              <Text style={{ color: theme.colors.textSecondary, ...theme.typography.caption, marginTop: 2 }}>
                Projected {projectedDate}
              </Text>
            ) : null}

            {paceLines.needed ? (
              <Text style={{ color: theme.colors.text, ...theme.typography.body, marginTop: 10 }}>
                {paceLines.needed}
              </Text>
            ) : recommendation ? (
              <Text style={{ color: theme.colors.text, ...theme.typography.body, marginTop: 10 }}>
                {recommendation}
              </Text>
            ) : null}
            {paceLines.pace ? (
              <Text style={{ color: theme.colors.textMuted, ...theme.typography.caption, marginTop: 2 }}>
                {paceLines.pace}
              </Text>
            ) : null}
          </Card>

          {forecastRows.length > 0 ? (
            <Card>
              <Text style={{ color: theme.colors.text, ...theme.typography.bodyStrong, marginBottom: 8 }}>
                Forecast
              </Text>
              {forecastRows.map((row) => (
                <ForecastRow key={row.label} label={row.label} value={row.value} tone={row.tone} />
              ))}
              {advancedRows.length > 0 ? (
                <>
                  <Pressable
                    onPress={() => setForecastExpanded((v) => !v)}
                    accessibilityRole="button"
                    accessibilityLabel={forecastExpanded ? "Hide more details" : "More details"}
                    style={{ paddingVertical: 10 }}
                  >
                    <Text style={{ color: theme.colors.tint, fontWeight: "600" }}>
                      {forecastExpanded ? "Hide details" : "More details ›"}
                    </Text>
                  </Pressable>
                  {forecastExpanded
                    ? advancedRows.map((row) => (
                        <ForecastRow
                          key={row.label}
                          label={row.label}
                          value={row.value}
                          tone={row.tone}
                        />
                      ))
                    : null}
                </>
              ) : null}
            </Card>
          ) : null}

          {linkedAccountName ? (
            <Card>
              <Text style={{ color: theme.colors.textMuted, ...theme.typography.caption, marginBottom: 6 }}>
                Linked account
              </Text>
              <NavRow
                title={linkedAccountName}
                onPress={() => linkedAccountId && router.push(goalAccountPath(linkedAccountId))}
              />
              {goal.automatic_transfer_label ? (
                <View style={{ marginTop: 10 }}>
                  <Text style={{ color: theme.colors.textMuted, ...theme.typography.caption }}>
                    Automatic funding
                  </Text>
                  <Text style={{ color: theme.colors.text, ...theme.typography.body, marginTop: 2 }}>
                    {goal.automatic_transfer_label}
                  </Text>
                </View>
              ) : goal.has_automatic_funding === false ? (
                <Text style={{ color: theme.colors.textMuted, ...theme.typography.caption, marginTop: 8 }}>
                  No automatic funding configured
                </Text>
              ) : null}
              {linkedAccountId ? (
                <View style={{ marginTop: 8, borderTopWidth: 1, borderTopColor: theme.colors.border, paddingTop: 8 }}>
                  <NavRow
                    title="Related transactions"
                    onPress={() => router.push(goalRelatedTransactionsPath(linkedAccountId))}
                  />
                </View>
              ) : null}
            </Card>
          ) : null}

          {recentHistory.length > 0 ? (
            <Card>
              <Text style={{ color: theme.colors.text, ...theme.typography.bodyStrong, marginBottom: 8 }}>
                Recent contributions
              </Text>
              {recentHistory.map((entry) => (
                <View
                  key={entry.id}
                  style={{
                    flexDirection: "row",
                    justifyContent: "space-between",
                    paddingVertical: 8,
                    borderBottomWidth: 1,
                    borderBottomColor: theme.colors.border,
                  }}
                >
                  <Text
                    style={{
                      color:
                        parseFloat(entry.amount) < 0
                          ? theme.colors.warning
                          : theme.colors.text,
                      fontWeight: "600",
                    }}
                  >
                    {formatCurrency(entry.amount)}
                  </Text>
                  <Text style={{ color: theme.colors.textMuted, ...theme.typography.caption }}>
                    {formatShortMonthDay(entry.date)}
                  </Text>
                </View>
              ))}
              <Pressable
                onPress={() => router.push(goalContributionHistoryPath(goal.id))}
                accessibilityRole="button"
                accessibilityLabel="View all contributions"
                style={{ paddingTop: 12 }}
              >
                <Text style={{ color: theme.colors.tint, fontWeight: "600" }}>View all ›</Text>
              </Pressable>
            </Card>
          ) : null}
        </View>
      )}

      <GoalActionsSheet
        visible={actionsOpen}
        goal={goal}
        includeWhatIf
        onClose={() => setActionsOpen(false)}
        onAction={onAction}
      />

      <ConfirmDialog
        visible={deleteOpen}
        title="Delete goal?"
        message={
          goal
            ? `Delete "${goal.name}"? This removes the goal and its progress tracking. Linked accounts and transactions are not deleted.`
            : ""
        }
        confirmLabel="Delete"
        destructive
        loading={deleteMu.isPending}
        onConfirm={() => deleteMu.mutate(goalId)}
        onCancel={() => setDeleteOpen(false)}
      />
    </Screen>
  );
}
