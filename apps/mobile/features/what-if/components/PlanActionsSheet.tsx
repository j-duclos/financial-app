import React from "react";
import { View } from "react-native";
import { BottomSheet, Button, TextField } from "@/components/ui";
import { SheetActionRow } from "@/components/forms";
import { useTheme } from "@/theme";

export type PlanActionId = "duplicate" | "delete";

type Props = {
  visible: boolean;
  planName: string;
  onClose: () => void;
  onAction: (action: PlanActionId) => void;
  onRename: (name: string) => void;
  renaming?: boolean;
};

export function PlanActionsSheet({
  visible,
  planName,
  onClose,
  onAction,
  onRename,
  renaming,
}: Props) {
  const theme = useTheme();
  const [renamingOpen, setRenamingOpen] = React.useState(false);
  const [draftName, setDraftName] = React.useState(planName);

  if (renamingOpen) {
    return (
      <BottomSheet
        visible={visible}
        title="Rename plan"
        onClose={() => {
          setRenamingOpen(false);
          onClose();
        }}
      >
        <View style={{ gap: theme.spacing.md }}>
          <TextField label="Plan name" value={draftName} onChangeText={setDraftName} />
          <Button
            label="Save name"
            loading={renaming}
            onPress={() => {
              const next = draftName.trim();
              if (!next) return;
              onRename(next);
              setRenamingOpen(false);
            }}
          />
        </View>
      </BottomSheet>
    );
  }

  return (
    <BottomSheet
      visible={visible}
      title={planName}
      onClose={() => {
        setRenamingOpen(false);
        onClose();
      }}
    >
      <View>
        <SheetActionRow
          label="Rename plan"
          onPress={() => {
            setDraftName(planName);
            setRenamingOpen(true);
          }}
        />
        <SheetActionRow label="Duplicate plan" onPress={() => onAction("duplicate")} />
        <SheetActionRow label="Delete plan" destructive onPress={() => onAction("delete")} />
      </View>
    </BottomSheet>
  );
}
