import React from "react";
import { Pressable, Text, type ViewStyle } from "react-native";
import FontAwesome from "@expo/vector-icons/FontAwesome";
import { useTheme } from "@/theme";

type Props = {
  label: string;
  onPress: () => void;
  destructive?: boolean;
  disabled?: boolean;
  icon?: React.ComponentProps<typeof FontAwesome>["name"];
  style?: ViewStyle;
};

/** Single action row inside an overflow / actions bottom sheet. */
export function SheetActionRow({ label, onPress, destructive, disabled, icon, style }: Props) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      style={({ pressed }) => ({
        opacity: pressed || disabled ? 0.7 : 1,
        minHeight: theme.touchTarget,
        paddingVertical: 14,
        borderBottomWidth: 1,
        borderBottomColor: theme.colors.border,
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        ...style,
      })}
    >
      {icon ? (
        <FontAwesome
          name={icon}
          size={16}
          color={destructive ? theme.colors.critical : theme.colors.textMuted}
        />
      ) : null}
      <Text
        style={{
          color: destructive ? theme.colors.critical : theme.colors.text,
          fontSize: 16,
          fontWeight: destructive ? "600" : "500",
          flex: 1,
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}
