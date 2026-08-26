import React from "react";
import {
  Pressable,
  StyleSheet,
  type PressableProps,
} from "react-native";
import FontAwesome from "@expo/vector-icons/FontAwesome";
import { useTheme } from "@/theme";

type Props = PressableProps & {
  name: React.ComponentProps<typeof FontAwesome>["name"];
  accessibilityLabel: string;
  size?: number;
  color?: string;
};

export function IconButton({
  name,
  accessibilityLabel,
  size = 22,
  color,
  style,
  ...rest
}: Props) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      hitSlop={8}
      style={({ pressed }) => [
        styles.base,
        {
          minWidth: theme.touchTarget,
          minHeight: theme.touchTarget,
          opacity: pressed ? 0.6 : 1,
        },
        style as object,
      ]}
      {...rest}
    >
      <FontAwesome name={name} size={size} color={color ?? theme.colors.text} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: { alignItems: "center", justifyContent: "center" },
});
