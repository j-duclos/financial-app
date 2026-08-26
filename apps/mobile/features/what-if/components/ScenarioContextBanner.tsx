import React from "react";
import { Text, View } from "react-native";
import { Card } from "@/components/ui";
import { useTheme } from "@/theme";

type Props = {
  goalId: number | null;
  debtId: number | null;
};

export function ScenarioContextBanner({ goalId, debtId }: Props) {
  const theme = useTheme();
  if (!goalId && !debtId) return null;

  return (
    <Card
      style={{
        marginBottom: theme.spacing.md,
        backgroundColor: theme.colors.tintMuted,
        borderColor: theme.colors.tint,
        borderWidth: 1,
      }}
    >
      <Text style={{ color: theme.colors.tint, ...theme.typography.label, letterSpacing: 0.5 }}>
        SCENARIO MODE
      </Text>
      <Text style={{ color: theme.colors.text, ...theme.typography.body, marginTop: 6 }}>
        {goalId
          ? "Opened from Goals. Changes here are hypothetical until you apply them."
          : "Opened from Payment Planner. Model a payoff change here — your real accounts stay unchanged."}
      </Text>
    </Card>
  );
}
