import React from "react";
import { View } from "react-native";
import type { FinancialGoal } from "@budget-app/shared";
import { BottomSheet } from "@/components/ui";
import { SheetActionRow } from "@/components/forms";

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
        <SheetActionRow label="Edit goal" onPress={() => onAction("edit")} />
        {includeWhatIf ? (
          <SheetActionRow label="Run What-If" onPress={() => onAction("what-if")} />
        ) : null}
        <SheetActionRow label="Duplicate goal" onPress={() => onAction("duplicate")} />
        {isActive ? (
          <>
            <SheetActionRow label="Pause goal" onPress={() => onAction("pause")} />
            <SheetActionRow label="Mark complete" onPress={() => onAction("complete")} />
          </>
        ) : null}
        {isActive || isPaused ? (
          <SheetActionRow label="Archive goal" onPress={() => onAction("archive")} />
        ) : null}
        <SheetActionRow label="Delete goal" onPress={() => onAction("delete")} destructive />
      </View>
    </BottomSheet>
  );
}
