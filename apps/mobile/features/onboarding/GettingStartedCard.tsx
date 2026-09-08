import React from "react";
import { Pressable, Text, View } from "react-native";
import FontAwesome from "@expo/vector-icons/FontAwesome";
import {
  canCollapseGettingStarted,
  GETTING_STARTED_COPY,
  GETTING_STARTED_STEPS,
  gettingStartedCompletedCount,
  GETTING_STARTED_STEP_COUNT,
  type GettingStartedCompletion,
  type GettingStartedStepId,
} from "@budget-app/shared";
import { Button, Card } from "@/components/ui";
import { useTheme } from "@/theme";

type Props = {
  completion: GettingStartedCompletion;
  onStepPress: (id: GettingStartedStepId) => void;
  onCollapse?: () => void;
};

export function GettingStartedCard({ completion, onStepPress, onCollapse }: Props) {
  const theme = useTheme();
  const completedCount = gettingStartedCompletedCount(completion);
  const canCollapse = Boolean(onCollapse) && canCollapseGettingStarted(completion);

  return (
    <Card testID="getting-started-checklist" style={{ marginBottom: theme.spacing.lg }}>
      <Text
        accessibilityRole="header"
        nativeID="getting-started-heading"
        style={{ color: theme.colors.text, ...theme.typography.headline }}
      >
        {GETTING_STARTED_COPY.checklistTitle}
      </Text>
      <Text
        style={{
          color: theme.colors.textSecondary,
          ...theme.typography.caption,
          marginTop: theme.spacing.sm,
        }}
      >
        {GETTING_STARTED_COPY.checklistIntro}
      </Text>
      <Text
        accessibilityLiveRegion="polite"
        style={{
          color: theme.colors.textMuted,
          ...theme.typography.caption,
          marginTop: theme.spacing.sm,
          marginBottom: theme.spacing.sm,
        }}
      >
        {completedCount} of {GETTING_STARTED_STEP_COUNT} complete
      </Text>
      {GETTING_STARTED_STEPS.map((step) => {
        const done = completion[step.id];
        return (
          <Pressable
            key={step.id}
            onPress={() => onStepPress(step.id)}
            accessibilityRole="button"
            accessibilityLabel={`${step.title}, ${done ? "complete" : "not complete"}`}
            style={({ pressed }) => ({
              flexDirection: "row",
              alignItems: "center",
              minHeight: theme.touchTarget,
              gap: theme.spacing.md,
              opacity: pressed ? 0.72 : 1,
            })}
          >
            <View
              accessibilityElementsHidden
              importantForAccessibility="no"
              style={{
                width: 22,
                height: 22,
                borderRadius: 11,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: done ? theme.colors.tintMuted : theme.colors.surfaceMuted,
                borderWidth: 1,
                borderColor: done ? theme.colors.tint : theme.colors.border,
              }}
            >
              {done ? (
                <FontAwesome name="check" size={12} color={theme.colors.tint} />
              ) : (
                <View
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: 4,
                    backgroundColor: theme.colors.border,
                  }}
                />
              )}
            </View>
            <Text
              style={{
                flex: 1,
                color: theme.colors.text,
                ...theme.typography.body,
                textDecorationLine: done ? "none" : "none",
              }}
            >
              {step.title}
            </Text>
            <FontAwesome name="chevron-right" size={12} color={theme.colors.textMuted} />
          </Pressable>
        );
      })}
      {canCollapse ? (
        <View style={{ marginTop: theme.spacing.sm }}>
          <Button
            label={GETTING_STARTED_COPY.collapseLabel}
            variant="ghost"
            onPress={onCollapse}
          />
        </View>
      ) : null}
    </Card>
  );
}
