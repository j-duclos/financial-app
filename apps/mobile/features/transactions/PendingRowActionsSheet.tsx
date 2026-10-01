import React from "react";
import { View } from "react-native";
import { BottomSheet } from "@/components/ui";
import { SheetActionRow } from "@/components/forms";
import type { PendingRowAction } from "./pendingLedgerActions";

type Props = {
  visible: boolean;
  title?: string;
  actions: PendingRowAction[];
  disabled?: boolean;
  onClose: () => void;
  onSelect: (action: PendingRowAction) => void;
};

export function PendingRowActionsSheet({
  visible,
  title = "Pending transaction",
  actions,
  disabled,
  onClose,
  onSelect,
}: Props) {
  return (
    <BottomSheet visible={visible} title={title} onClose={onClose}>
      <View>
        {actions.map((action) => (
          <SheetActionRow
            key={action.kind}
            label={action.label}
            disabled={disabled}
            onPress={() => onSelect(action)}
          />
        ))}
      </View>
    </BottomSheet>
  );
}
