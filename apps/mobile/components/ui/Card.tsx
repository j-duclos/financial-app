import React from "react";
import { Pressable, StyleSheet, View, type ViewProps, type StyleProp, type ViewStyle } from "react-native";
import { useTheme } from "@/theme";

type Props = ViewProps & {
  onPress?: () => void;
  padded?: boolean;
  style?: StyleProp<ViewStyle>;
};

export function Card({ children, onPress, padded = true, style, ...rest }: Props) {
  const theme = useTheme();
  const body = (
    <View
      style={[
        {
          backgroundColor: theme.colors.surface,
          borderRadius: theme.radius.lg,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: theme.colors.border,
          padding: padded ? theme.spacing.lg : 0,
        },
        style,
      ]}
      {...rest}
    >
      {children}
    </View>
  );

  if (!onPress) return body;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [{ opacity: pressed ? 0.92 : 1 }]}
    >
      {body}
    </Pressable>
  );
}
