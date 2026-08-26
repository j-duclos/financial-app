import React from "react";
import {
  ScrollView,
  StyleSheet,
  View,
  type ScrollViewProps,
  type ViewProps,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTheme } from "@/theme";

type Props = ViewProps & {
  scroll?: boolean;
  scrollProps?: ScrollViewProps;
  edges?: ("top" | "right" | "bottom" | "left")[];
  contentStyle?: StyleProp<ViewStyle>;
};

export function Screen({
  children,
  scroll = false,
  scrollProps,
  edges = ["top", "left", "right"],
  style,
  contentStyle,
  ...rest
}: Props) {
  const theme = useTheme();
  const base = [
    styles.flex,
    { backgroundColor: theme.colors.background, paddingHorizontal: theme.spacing.lg },
    style,
  ];

  if (scroll) {
    return (
      <SafeAreaView style={base} edges={edges} {...rest}>
        <ScrollView
          contentContainerStyle={[{ paddingBottom: theme.spacing.xxl }, contentStyle]}
          keyboardShouldPersistTaps="handled"
          {...scrollProps}
        >
          {children}
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={base} edges={edges} {...rest}>
      <View style={[{ flex: 1 }, contentStyle]}>{children}</View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
});
