import React, { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { BottomSheet, Button, TextField } from "@/components/ui";
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

export function PlanActionsSheet({
  visible,
  planName,
  onClose,
  onAction,
  onRename,
  renaming,
}: Props) {
  const theme = useTheme();
  const [renamingOpen, setRenamingOpen] = useState(false);
  const [draftName, setDraftName] = useState(planName);

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
        <ActionRow
          label="Rename plan"
          onPress={() => {
            setDraftName(planName);
            setRenamingOpen(true);
          }}
        />
        <ActionRow label="Duplicate plan" onPress={() => onAction("duplicate")} />
        <ActionRow label="Delete plan" destructive onPress={() => onAction("delete")} />
      </View>
    </BottomSheet>
  );
}
