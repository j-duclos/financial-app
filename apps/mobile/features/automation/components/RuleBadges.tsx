import React from "react";
import { Text, View } from "react-native";
import { StatusChip } from "@/components/ui";
import { useTheme } from "@/theme";

type Props = {
  label: string;
};

export function TriggerBadge({ label }: Props) {
  return <StatusChip label={label} tone="neutral" />;
}

export function ActionBadge({ label }: Props) {
  const theme = useTheme();
  return (
    <View
      style={{
        alignSelf: "flex-start",
        paddingHorizontal: 10,
        paddingVertical: 4,
        borderRadius: 999,
        backgroundColor: theme.colors.tintMuted,
      }}
    >
      <Text style={{ color: theme.colors.tint, fontSize: 12, fontWeight: "600" }}>{label}</Text>
    </View>
  );
}
