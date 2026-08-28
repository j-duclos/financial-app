import React from "react";
import { View } from "react-native";
import { BottomSheet } from "@/components/ui";
import { SheetActionRow } from "@/components/forms";
import type { RecommendationAction } from "./navigation";

type Props = {
  visible: boolean;
  title?: string;
  actions: RecommendationAction[];
  onClose: () => void;
  onSelect: (action: RecommendationAction) => void;
};

export function RecommendationOverflowSheet({
  visible,
  title = "Actions",
  actions,
  onClose,
  onSelect,
}: Props) {
  return (
    <BottomSheet visible={visible} title={title} onClose={onClose}>
      <View>
        {actions.map((action) => (
          <SheetActionRow
            key={`${action.kind}-${action.label}`}
            label={action.label}
            destructive={action.kind === "dismiss"}
            onPress={() => onSelect(action)}
          />
        ))}
      </View>
    </BottomSheet>
  );
}
