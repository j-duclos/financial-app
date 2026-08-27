import React, { useMemo, useState } from "react";
import { RefreshControl, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { formatCurrency } from "@budget-app/shared";
import {
  archiveBucket,
  completeBucket,
  deleteBucket,
  duplicateBucket,
  getBucketsOverview,
  pauseBucket,
} from "@budget-app/api-client";
import {
  AppHeader,
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  Screen,
  SkeletonBlock,
} from "@/components/ui";
import { useTheme } from "@/theme";
import { useDefaultHouseholdId } from "@/hooks/useDefaultHouseholdId";
import { describeApiError } from "@/services/api";
import { GoalCard, GoalSectionHeader } from "./GoalCard";
import { GoalActionsSheet, type GoalActionId } from "./GoalActionsSheet";
import { goalCreatePath, goalDetailPath, goalEditPath } from "./navigation";
import { goalsQueryKeys, invalidateGoalsQueries } from "./queryKeys";
import type { FinancialGoal } from "@budget-app/shared";

export function GoalsScreen() {
  const theme = useTheme();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { householdId, isReady } = useDefaultHouseholdId();
  const [actionsGoal, setActionsGoal] = useState<FinancialGoal | null>(null);
  const [deleteGoal, setDeleteGoal] = useState<FinancialGoal | null>(null);

  const {
    data: overview,
    isLoading,
    isError,
    error,
    refetch,
    isFetching,
  } = useQuery({
    queryKey: goalsQueryKeys.overview(householdId),
    queryFn: () => getBucketsOverview({ household: householdId! }),
    enabled: isReady && householdId != null,
  });

  const goals = overview?.goals ?? [];
  const summary = overview?.summary;

  const active = useMemo(
    () => goals.filter((g) => g.status === "active" || g.status === "paused"),
    [goals]
  );
  const completed = useMemo(() => goals.filter((g) => g.status === "completed"), [goals]);
  const archived = useMemo(() => goals.filter((g) => g.status === "archived"), [goals]);

  const invalidate = () => invalidateGoalsQueries(queryClient);

  const pauseMu = useMutation({ mutationFn: pauseBucket, onSuccess: invalidate });
  const completeMu = useMutation({ mutationFn: completeBucket, onSuccess: invalidate });
  const archiveMu = useMutation({ mutationFn: archiveBucket, onSuccess: invalidate });
  const duplicateMu = useMutation({
    mutationFn: duplicateBucket,
    onSuccess: (g) => {
      invalidate();
      router.push(goalDetailPath(g.id));
    },
  });
  const deleteMu = useMutation({
    mutationFn: deleteBucket,
    onSuccess: () => {
      invalidate();
      setDeleteGoal(null);
    },
  });

  const onAction = (action: GoalActionId) => {
    const goal = actionsGoal;
    if (!goal) return;
    setActionsGoal(null);
    switch (action) {
      case "edit":
        router.push(goalEditPath(goal.id));
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
        setDeleteGoal(goal);
        break;
      default:
        break;
    }
  };

  if (!isReady) {
    return (
      <Screen scroll={false}>
        <SkeletonBlock lines={6} />
      </Screen>
    );
  }

  if (householdId == null) {
    return (
      <Screen scroll={false}>
        <EmptyState
          title="Default household required"
          message="Set a default household in Profile & Settings to manage goals."
        />
      </Screen>
    );
  }

  return (
    <Screen
      scroll
      scrollProps={{
        refreshControl: (
          <RefreshControl refreshing={isFetching && !isLoading} onRefresh={() => refetch()} />
        ),
      }}
    >
      <AppHeader title="Goals" subtitle="What am I trying to accomplish?" showBack />

      {isLoading ? (
        <SkeletonBlock lines={8} />
      ) : isError ? (
        <ErrorState message={describeApiError(error)} onRetry={() => refetch()} />
      ) : (
        <>
          {summary && active.length > 0 ? (
            <Card style={{ marginBottom: theme.spacing.md }}>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
                <View style={{ minWidth: "45%" }}>
                  <Text style={{ color: theme.colors.textMuted, ...theme.typography.caption }}>
                    Total saved
                  </Text>
                  <Text style={{ color: theme.colors.text, ...theme.typography.bodyStrong }}>
                    {formatCurrency(summary.total_saved)}
                  </Text>
                </View>
                <View style={{ minWidth: "45%" }}>
                  <Text style={{ color: theme.colors.textMuted, ...theme.typography.caption }}>
                    Total target
                  </Text>
                  <Text style={{ color: theme.colors.text, ...theme.typography.bodyStrong }}>
                    {formatCurrency(summary.total_target)}
                  </Text>
                </View>
                <View style={{ minWidth: "45%" }}>
                  <Text style={{ color: theme.colors.textMuted, ...theme.typography.caption }}>
                    On track
                  </Text>
                  <Text style={{ color: theme.colors.text, ...theme.typography.bodyStrong }}>
                    {summary.goals_on_track}/{summary.goals_active_count}
                  </Text>
                </View>
                {summary.monthly_needed_total && parseFloat(summary.monthly_needed_total) > 0 ? (
                  <View style={{ minWidth: "45%" }}>
                    <Text style={{ color: theme.colors.textMuted, ...theme.typography.caption }}>
                      Monthly needed
                    </Text>
                    <Text style={{ color: theme.colors.text, ...theme.typography.bodyStrong }}>
                      {formatCurrency(summary.monthly_needed_total)}/mo
                    </Text>
                  </View>
                ) : null}
              </View>
            </Card>
          ) : null}

          <View style={{ flexDirection: "row", justifyContent: "flex-end", marginBottom: theme.spacing.sm }}>
            <Button label="Create goal" onPress={() => router.push(goalCreatePath())} />
          </View>

          {goals.length === 0 ? (
            <EmptyState
              title="No goals yet"
              message="Create a goal to track savings, debt payoff, or another financial target."
              actionLabel="Create goal"
              onAction={() => router.push(goalCreatePath())}
            />
          ) : (
            <View style={{ gap: theme.spacing.sm }}>
              {active.length > 0 ? (
                <>
                  <GoalSectionHeader title="Active goals" count={active.length} />
                  {active.map((goal) => (
                    <GoalCard
                      key={goal.id}
                      goal={goal}
                      onPress={() => router.push(goalDetailPath(goal.id))}
                      onActions={() => setActionsGoal(goal)}
                    />
                  ))}
                </>
              ) : null}

              {completed.length > 0 ? (
                <>
                  <GoalSectionHeader title="Completed goals" count={completed.length} />
                  {completed.map((goal) => (
                    <GoalCard
                      key={goal.id}
                      goal={goal}
                      onPress={() => router.push(goalDetailPath(goal.id))}
                      onActions={() => setActionsGoal(goal)}
                    />
                  ))}
                </>
              ) : null}

              {archived.length > 0 ? (
                <>
                  <GoalSectionHeader title="Archived goals" count={archived.length} />
                  {archived.map((goal) => (
                    <GoalCard
                      key={goal.id}
                      goal={goal}
                      onPress={() => router.push(goalDetailPath(goal.id))}
                      onActions={() => setActionsGoal(goal)}
                    />
                  ))}
                </>
              ) : null}
            </View>
          )}
        </>
      )}

      <GoalActionsSheet
        visible={actionsGoal != null}
        goal={actionsGoal}
        onClose={() => setActionsGoal(null)}
        onAction={onAction}
      />

      <ConfirmDialog
        visible={deleteGoal != null}
        title="Delete goal?"
        message={
          deleteGoal
            ? `Delete "${deleteGoal.name}"? This removes the goal and its progress tracking. Linked accounts and transactions are not deleted.`
            : ""
        }
        confirmLabel="Delete"
        destructive
        loading={deleteMu.isPending}
        onConfirm={() => deleteGoal && deleteMu.mutate(deleteGoal.id)}
        onCancel={() => setDeleteGoal(null)}
      />
    </Screen>
  );
}
