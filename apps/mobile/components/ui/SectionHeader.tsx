import React from "react";
import { Pressable, Text, View } from "react-native";
import { useTheme } from "@/theme";
import { IconButton } from "./IconButton";

type Props = {
  title: string;
  subtitle?: string;
  actionLabel?: string;
  onAction?: () => void;
  infoAccessibilityLabel?: string;
  onInfoPress?: () => void;
};

export function SectionHeader({
  title,
  subtitle,
  actionLabel,
  onAction,
  infoAccessibilityLabel,
  onInfoPress,
}: Props) {
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
        <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
          <Text style={{ color: theme.colors.text, ...theme.typography.headline, flexShrink: 1 }}>
            {title}
          </Text>
          {infoAccessibilityLabel && onInfoPress ? (
            <IconButton
              name="info-circle"
              size={16}
              accessibilityLabel={infoAccessibilityLabel}
              onPress={onInfoPress}
              style={{ marginLeft: -4 }}
            />
          ) : null}
        </View>
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
