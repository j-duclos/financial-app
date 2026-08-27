import React from "react";
import { Pressable, Text, View } from "react-native";
import { useTheme } from "@/theme";

type Props = {
  label: string;
  value: string | null;
  placeholder?: string;
  onPress: () => void;
};

/** Compact tappable row that opens a picker sheet (matches Recurring/Goals). */
export function SelectRow({ label, value, placeholder = "Select", onPress }: Props) {
  const theme = useTheme();
  return (
    <View>
      <Text style={{ color: theme.colors.textSecondary, fontWeight: "600", marginBottom: 8 }}>{label}</Text>
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={`${label}, ${value ?? placeholder}`}
        style={{
          minHeight: theme.touchTarget,
          borderWidth: 1,
          borderColor: theme.colors.border,
          borderRadius: theme.radius.md,
          paddingHorizontal: 12,
          justifyContent: "center",
          backgroundColor: theme.colors.surfaceMuted,
          flexDirection: "row",
          alignItems: "center",
        }}
      >
        <Text style={{ flex: 1, color: value ? theme.colors.text : theme.colors.textMuted }} numberOfLines={1}>
          {value ?? placeholder}
        </Text>
        <Text style={{ color: theme.colors.textMuted }}>›</Text>
      </Pressable>
    </View>
  );
}
