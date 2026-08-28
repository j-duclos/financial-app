import React from "react";
import { Pressable, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { useTheme } from "@/theme";

type Props = {
  label: string;
  value: string | null;
  placeholder?: string;
  onPress: () => void;
  error?: string;
  disabled?: boolean;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
};

/** Labeled tappable field that opens a picker sheet. */
export function SelectField({
  label,
  value,
  placeholder = "Select",
  onPress,
  error,
  disabled = false,
  accessibilityLabel,
  style,
}: Props) {
  const theme = useTheme();
  const display = value ?? placeholder;
  return (
    <View style={style}>
      <Text style={{ color: theme.colors.textSecondary, fontWeight: "600", marginBottom: 8 }}>
        {label}
      </Text>
      <Pressable
        onPress={onPress}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel ?? `${label}, ${display}`}
        accessibilityState={{ disabled }}
        style={{
          minHeight: theme.touchTarget,
          borderWidth: 1,
          borderColor: error ? theme.colors.critical : theme.colors.border,
          borderRadius: theme.radius.md,
          paddingHorizontal: 12,
          justifyContent: "center",
          backgroundColor: theme.colors.surfaceMuted,
          flexDirection: "row",
          alignItems: "center",
          opacity: disabled ? 0.5 : 1,
        }}
      >
        <Text
          style={{ flex: 1, color: value ? theme.colors.text : theme.colors.textMuted }}
          numberOfLines={1}
        >
          {display}
        </Text>
        <Text style={{ color: theme.colors.textMuted }}>›</Text>
      </Pressable>
      {error ? (
        <Text style={{ color: theme.colors.critical, fontSize: 12, marginTop: 4 }}>{error}</Text>
      ) : null}
    </View>
  );
}
