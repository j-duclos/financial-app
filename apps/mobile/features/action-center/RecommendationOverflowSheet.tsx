import React from "react";
import { Pressable, Text, View } from "react-native";
import { BottomSheet } from "@/components/ui";
import { useTheme } from "@/theme";
import type { RecommendationAction } from "./navigation";

type Props = {
  visible: boolean;
  title?: string;
  actions: RecommendationAction[];
  onClose: () => void;
  onSelect: (action: RecommendationAction) => void;
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
          <ActionRow
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
