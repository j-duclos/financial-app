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
  Card,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  IconButton,
  Screen,
  SkeletonBlock,
} from "@/components/ui";
import { useTheme } from "@/theme";
import { useDefaultHouseholdId } from "@/hooks/useDefaultHouseholdId";
import { describeApiError } from "@/services/api";
import { GoalCard, GoalSectionHeader } from "./GoalCard";
import { GoalActionsSheet, type GoalActionId } from "./GoalActionsSheet";
import { goalCreatePath, goalDetailPath, goalEditPath, goalWhatIfPath } from "./navigation";
import { goalsQueryKeys, invalidateGoalsQueries } from "./queryKeys";
import type { FinancialGoal } from "@budget-app/shared";

function SummaryStat({ label, value }: { label: string; value: string }) {
  const theme = useTheme();
  return (
    <View style={{ width: "47%" }}>
      <Text style={{ color: theme.colors.textMuted, ...theme.typography.caption }}>{label}</Text>
      <Text style={{ color: theme.colors.text, ...theme.typography.bodyStrong, marginTop: 2 }}>
        {value}
      </Text>
    </View>
  );
}

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
      <AppHeader
        title="Goals"
        showBack
        right={
          <IconButton
            name="plus"
            accessibilityLabel="Create goal"
            onPress={() => router.push(goalCreatePath())}
          />
        }
      />

      {isLoading ? (
        <SkeletonBlock lines={8} />
      ) : isError ? (
        <ErrorState message={describeApiError(error)} onRetry={() => refetch()} />
      ) : (
        <>
          {summary && active.length > 0 ? (
            <Card style={{ marginBottom: theme.spacing.md, paddingVertical: theme.spacing.sm }}>
              <View style={{ flexDirection: "row", flexWrap: "wrap", rowGap: 10, columnGap: 8 }}>
                <SummaryStat label="Total saved" value={formatCurrency(summary.total_saved)} />
                <SummaryStat label="Total target" value={formatCurrency(summary.total_target)} />
                <SummaryStat
                  label="On track"
                  value={`${summary.goals_on_track}/${summary.goals_active_count}`}
                />
                <SummaryStat
                  label="Monthly needed"
                  value={
                    summary.monthly_needed_total && parseFloat(summary.monthly_needed_total) > 0
                      ? `${formatCurrency(summary.monthly_needed_total)}/mo`
                      : "—"
                  }
                />
              </View>
            </Card>
          ) : null}

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
