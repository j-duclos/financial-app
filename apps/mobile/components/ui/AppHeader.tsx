import React from "react";
import { Pressable, StyleSheet, Text, View, type ViewStyle } from "react-native";
import { useTheme } from "@/theme";
import { useStackBack, SECONDARY_SCREEN_BACK_FALLBACK } from "@/lib/stackNavigation";
import type { Href } from "expo-router";

type Props = {
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
  /** Explicit back handler; overrides showBack when provided. */
  onBack?: () => void;
  /** Show a stack Back control using navigateStackBack semantics. */
  showBack?: boolean;
  backFallbackHref?: Href;
  style?: ViewStyle;
};

export function AppHeader({
  title,
  subtitle,
  right,
  onBack,
  showBack = false,
  backFallbackHref,
  style,
}: Props) {
  const theme = useTheme();
  const stackBack = useStackBack(backFallbackHref ?? SECONDARY_SCREEN_BACK_FALLBACK);
  const handleBack = onBack ?? (showBack ? stackBack : undefined);

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
        {handleBack ? (
          <Pressable
            onPress={handleBack}
            accessibilityRole="button"
            accessibilityLabel="Back"
            hitSlop={8}
            style={{
              minWidth: theme.touchTarget,
              minHeight: theme.touchTarget,
              justifyContent: "center",
              paddingRight: 4,
            }}
          >
            <Text style={{ color: theme.colors.tint, fontSize: 17, fontWeight: "400" }}>{"< Back"}</Text>
          </Pressable>
        ) : null}
        <View style={{ flexShrink: 1, flex: 1 }}>
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
