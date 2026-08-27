import React from "react";
import { Pressable, Text, View } from "react-native";
import FontAwesome from "@expo/vector-icons/FontAwesome";
import { useTheme } from "@/theme";

type Props = {
  title: string;
  value?: string;
  onPress?: () => void;
  accessibilityLabel?: string;
  disabled?: boolean;
};

/** Compact iOS-style settings row: title left, value + chevron right. */
export function SettingsRow({ title, value, onPress, accessibilityLabel, disabled }: Props) {
  const theme = useTheme();
  const label = accessibilityLabel ?? (value ? `${title}, ${value}` : title);

  const content = (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        minHeight: theme.touchTarget,
        paddingVertical: theme.spacing.sm,
        borderBottomWidth: StyleSheetHairline,
        borderBottomColor: theme.colors.border,
        gap: theme.spacing.md,
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <Text style={{ flex: 1, color: theme.colors.text, ...theme.typography.body }}>{title}</Text>
      {value ? (
        <Text style={{ color: theme.colors.textSecondary, ...theme.typography.body }} numberOfLines={1}>
          {value}
        </Text>
      ) : null}
      {onPress && !disabled ? (
        <FontAwesome name="chevron-right" size={12} color={theme.colors.textMuted} />
      ) : null}
    </View>
  );

  if (!onPress || disabled) return content;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [{ opacity: pressed ? 0.7 : 1 }]}
    >
      {content}
    </Pressable>
  );
}

const StyleSheetHairline = 1 / 2;
