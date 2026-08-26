import React from "react";
import { Pressable, StyleSheet, Text, View, type ViewStyle } from "react-native";
import { useTheme } from "@/theme";

type Props = {
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
  onBack?: () => void;
  style?: ViewStyle;
};

export function AppHeader({ title, subtitle, right, onBack, style }: Props) {
  const theme = useTheme();
  return (
    <View
      style={[
        styles.row,
        {
          paddingVertical: theme.spacing.md,
          borderBottomWidth: StyleSheet.hairlineWidth,
          borderBottomColor: theme.colors.border,
          marginBottom: theme.spacing.md,
        },
        style,
      ]}
    >
      <View style={styles.left}>
        {onBack ? (
          <Pressable
            onPress={onBack}
            accessibilityRole="button"
            accessibilityLabel="Go back"
            hitSlop={8}
            style={{ minWidth: theme.touchTarget, minHeight: theme.touchTarget, justifyContent: "center" }}
          >
            <Text style={{ color: theme.colors.tint, fontSize: 16, fontWeight: "600" }}>Back</Text>
          </Pressable>
        ) : null}
        <View style={{ flexShrink: 1 }}>
          <Text
            style={{ color: theme.colors.text, ...theme.typography.headline }}
            accessibilityRole="header"
          >
            {title}
          </Text>
          {subtitle ? (
            <Text style={{ color: theme.colors.textMuted, ...theme.typography.caption, marginTop: 2 }}>
              {subtitle}
            </Text>
          ) : null}
        </View>
      </View>
      {right ? <View style={styles.right}>{right}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  left: { flexDirection: "row", alignItems: "center", gap: 8, flex: 1 },
  right: { flexShrink: 0 },
});
