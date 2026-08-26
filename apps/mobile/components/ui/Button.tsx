import React from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  type PressableProps,
} from "react-native";
import { useTheme } from "@/theme";

type Variant = "primary" | "secondary" | "danger" | "ghost";

type Props = PressableProps & {
  label: string;
  variant?: Variant;
  loading?: boolean;
};

export function Button({
  label,
  variant = "primary",
  loading = false,
  disabled,
  style,
  ...rest
}: Props) {
  const theme = useTheme();
  const isDisabled = disabled || loading;

  const colors = (() => {
    switch (variant) {
      case "secondary":
        return {
          bg: theme.colors.surfaceMuted,
          fg: theme.colors.text,
          border: theme.colors.border,
        };
      case "danger":
        return {
          bg: theme.colors.critical,
          fg: "#FFFFFF",
          border: theme.colors.critical,
        };
      case "ghost":
        return {
          bg: "transparent",
          fg: theme.colors.tint,
          border: "transparent",
        };
      default:
        return {
          bg: theme.colors.tint,
          fg: theme.colors.onTint,
          border: theme.colors.tint,
        };
    }
  })();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!isDisabled, busy: loading }}
      disabled={isDisabled}
      style={({ pressed }) => [
        styles.base,
        {
          minHeight: theme.touchTarget,
          backgroundColor: colors.bg,
          borderColor: colors.border,
          borderRadius: theme.radius.md,
          opacity: isDisabled ? 0.55 : pressed ? 0.88 : 1,
        },
        style as object,
      ]}
      {...rest}
    >
      {loading ? (
        <ActivityIndicator color={colors.fg} />
      ) : (
        <Text style={{ color: colors.fg, fontWeight: "600", fontSize: 16 }}>{label}</Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
    borderWidth: StyleSheet.hairlineWidth,
  },
});
