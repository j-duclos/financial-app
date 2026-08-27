import React, { memo } from "react";
import { Pressable, Text, View } from "react-native";
import type { DashboardGoalSummary } from "@budget-app/shared";
import { dashboardGoalPercent, formatGoalTargetDate, paceStatusLabel, paceStatusTone } from "@budget-app/shared";
import { Card, StatusChip } from "@/components/ui";
import { GoalProgressBar } from "@/features/goals/GoalProgressBar";
import { useTheme } from "@/theme";
import {
  dashboardGoalAccessibilityLabel,
  dashboardGoalProgressSummary,
  dashboardGoalSummaryRecommendation,
} from "./dashboardGoalDisplay";

type Props = {
  goal: DashboardGoalSummary;
  onPress: () => void;
};

export const DashboardGoalCard = memo(function DashboardGoalCard({ goal, onPress }: Props) {
  const theme = useTheme();
  const statusLabel = paceStatusLabel(goal.pace_status ?? goal.on_track_status);
  const statusTone = paceStatusTone(goal.pace_status ?? goal.on_track_status);
  const targetDate = formatGoalTargetDate(goal.target_date);
  const recommendation = dashboardGoalSummaryRecommendation(goal);
  const progressPercent = dashboardGoalPercent(goal.progress_percent);

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={dashboardGoalAccessibilityLabel(goal)}
      style={({ pressed }) => ({ opacity: pressed ? 0.88 : 1 })}
    >
      <Card style={{ padding: theme.spacing.md }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Text
            style={{ color: theme.colors.text, ...theme.typography.bodyStrong, flex: 1, flexShrink: 1 }}
            numberOfLines={1}
            ellipsizeMode="tail"
          >
            {goal.name}
          </Text>
          {statusLabel ? (
            <View style={{ flexShrink: 0, opacity: 0.92 }}>
              <StatusChip label={statusLabel} tone={statusTone} />
            </View>
          ) : null}
        </View>

        <Text style={{ color: theme.colors.textMuted, ...theme.typography.caption, marginTop: 6 }}>
          {dashboardGoalProgressSummary(goal)}
        </Text>

        <View style={{ marginTop: 6 }}>
          <GoalProgressBar percent={progressPercent} thin />
        </View>

        {targetDate ? (
          <Text style={{ color: theme.colors.textSecondary, ...theme.typography.caption, marginTop: 6 }}>
            Target {targetDate}
          </Text>
        ) : null}

        {recommendation ? (
          <Text
            style={{
              color: theme.colors.text,
              ...theme.typography.caption,
              marginTop: 4,
            }}
            numberOfLines={2}
          >
            {recommendation}
          </Text>
        ) : null}
      </Card>
    </Pressable>
  );
});
