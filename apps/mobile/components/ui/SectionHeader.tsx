import React from "react";
import { Pressable, Text, View } from "react-native";
import { useTheme } from "@/theme";

type Props = {
  title: string;
  subtitle?: string;
  actionLabel?: string;
  onAction?: () => void;
};

export function SectionHeader({ title, subtitle, actionLabel, onAction }: Props) {
  const theme = useTheme();
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "flex-end",
        justifyContent: "space-between",
        marginBottom: theme.spacing.sm,
        marginTop: theme.spacing.md,
      }}
    >
      <View style={{ flex: 1, paddingRight: 8 }}>
        <Text style={{ color: theme.colors.text, ...theme.typography.headline }}>{title}</Text>
        {subtitle ? (
          <Text style={{ color: theme.colors.textMuted, ...theme.typography.caption, marginTop: 2 }}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {actionLabel && onAction ? (
        <Pressable
          onPress={onAction}
          accessibilityRole="button"
          accessibilityLabel={actionLabel}
          hitSlop={8}
          style={{ minHeight: theme.touchTarget, justifyContent: "center" }}
        >
          <Text style={{ color: theme.colors.tint, fontWeight: "600", fontSize: 14 }}>{actionLabel}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}
