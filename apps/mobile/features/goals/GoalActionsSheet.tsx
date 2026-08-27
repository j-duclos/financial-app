import React from "react";
import { Pressable, Text, View } from "react-native";
import type { FinancialGoal } from "@budget-app/shared";
import { BottomSheet } from "@/components/ui";
import { useTheme } from "@/theme";

export type GoalActionId =
  | "edit"
  | "what-if"
  | "duplicate"
  | "pause"
  | "complete"
  | "archive"
  | "delete";

type Props = {
  visible: boolean;
  goal: FinancialGoal | null;
  onClose: () => void;
  onAction: (action: GoalActionId) => void;
  /** When true, include What-If (detail overflow). */
  includeWhatIf?: boolean;
};

function ActionRow({
  label,
  onPress,
  destructive,
}: {
  label: string;
  onPress: () => void;
  destructive?: boolean;
}) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => ({
        opacity: pressed ? 0.7 : 1,
        paddingVertical: 14,
        borderBottomWidth: 1,
        borderBottomColor: theme.colors.border,
      })}
    >
      <Text
        style={{
          color: destructive ? theme.colors.critical : theme.colors.text,
          fontSize: 16,
          fontWeight: destructive ? "600" : "500",
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

export function GoalActionsSheet({
  visible,
  goal,
  onClose,
  onAction,
  includeWhatIf = false,
}: Props) {
  if (!goal) return null;
  const isActive = goal.status === "active";
  const isPaused = goal.status === "paused";

  return (
    <BottomSheet visible={visible} title={goal.name} onClose={onClose}>
      <View>
        <ActionRow label="Edit goal" onPress={() => onAction("edit")} />
        {includeWhatIf ? (
          <ActionRow label="Run What-If" onPress={() => onAction("what-if")} />
        ) : null}
        <ActionRow label="Duplicate goal" onPress={() => onAction("duplicate")} />
        {isActive ? (
          <>
            <ActionRow label="Pause goal" onPress={() => onAction("pause")} />
            <ActionRow label="Mark complete" onPress={() => onAction("complete")} />
          </>
        ) : null}
        {isActive || isPaused ? (
          <ActionRow label="Archive goal" onPress={() => onAction("archive")} />
        ) : null}
        <ActionRow label="Delete goal" onPress={() => onAction("delete")} destructive />
      </View>
    </BottomSheet>
  );
}
