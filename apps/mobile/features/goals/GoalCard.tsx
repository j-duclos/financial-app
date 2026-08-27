import React, { memo } from "react";
import { Pressable, Text, View } from "react-native";
import type { FinancialGoal } from "@budget-app/shared";
import {
  formatGoalProgressLine,
  formatGoalTargetDate,
  goalListStatusDisplay,
  goalSuggestionLine,
  parseProgressPercent,
} from "@budget-app/shared";
import { Card, IconButton, StatusChip } from "@/components/ui";
import { useTheme } from "@/theme";
import { GoalProgressBar } from "./GoalProgressBar";

type Props = {
  goal: FinancialGoal;
  onPress: () => void;
  onActions?: () => void;
};

export const GoalCard = memo(function GoalCard({ goal, onPress, onActions }: Props) {
  const theme = useTheme();
  const pct = parseProgressPercent(goal.progress_percent);
  const status = goalListStatusDisplay(goal);
  const targetDate = formatGoalTargetDate(goal.target_date);
  const suggestion = goalSuggestionLine(goal);

  return (
    <Card onPress={onPress}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 8 }}>
        <Text
          style={{ color: theme.colors.text, ...theme.typography.bodyStrong, flex: 1 }}
          numberOfLines={2}
        >
          {goal.name}
        </Text>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
          {status ? <StatusChip label={status.label} tone={status.tone} /> : null}
          {onActions ? (
            <IconButton name="ellipsis-v" accessibilityLabel="Goal actions" onPress={onActions} />
          ) : null}
        </View>
      </View>

      <View style={{ marginTop: 10 }}>
        <GoalProgressBar percent={pct} />
      </View>

      <Text style={{ color: theme.colors.text, ...theme.typography.body, marginTop: 8 }}>
        {formatGoalProgressLine(goal)}
      </Text>
      <Text style={{ color: theme.colors.textMuted, ...theme.typography.caption, marginTop: 4 }}>
        {pct}% complete
      </Text>

      {targetDate ? (
        <Text style={{ color: theme.colors.textSecondary, ...theme.typography.caption, marginTop: 4 }}>
          Target: {targetDate}
        </Text>
      ) : null}

      {suggestion ? (
        <Text style={{ color: theme.colors.text, ...theme.typography.caption, marginTop: 6 }}>
          {suggestion}
        </Text>
      ) : null}
    </Card>
  );
});

export function GoalSectionHeader({ title, count }: { title: string; count: number }) {
  const theme = useTheme();
  return (
    <Pressable accessibilityRole="header" style={{ marginTop: theme.spacing.lg, marginBottom: theme.spacing.sm }}>
      <Text style={{ color: theme.colors.textMuted, ...theme.typography.label }}>
        {title} ({count})
      </Text>
    </Pressable>
  );
}
