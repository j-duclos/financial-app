import React from "react";
import { Pressable, Text, View } from "react-native";
import { useTheme } from "@/theme";

type Props = {
  label: string;
  value: string;
  valueTone?: "default" | "muted" | "critical";
  multiline?: boolean;
  onPress?: () => void;
};

/**
 * Horizontal label/value row for detail screens (Recurring, Automation, Reconcile meta).
 * Transaction detail uses a stacked variant locally — different visual semantics.
 */
export function DetailRow({ label, value, valueTone = "default", multiline, onPress }: Props) {
  const theme = useTheme();
  const valueColor =
    valueTone === "critical"
      ? theme.colors.critical
      : valueTone === "muted"
        ? theme.colors.textMuted
        : theme.colors.text;

  const content = (
    <View style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 6, gap: 12 }}>
      <Text style={{ color: theme.colors.textMuted, fontSize: 14 }}>{label}</Text>
      <Text
        style={{
          color: valueColor,
          fontWeight: "600",
          flex: 1,
          textAlign: "right",
        }}
        numberOfLines={multiline ? undefined : 2}
      >
        {value}
      </Text>
    </View>
  );

  if (!onPress) return content;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${label}, ${value}`}
    >
      {content}
    </Pressable>
  );
}
