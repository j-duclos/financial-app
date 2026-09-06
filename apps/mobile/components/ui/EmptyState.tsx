import React from "react";
import { Text, View } from "react-native";
import { Button } from "./Button";
import { useTheme } from "@/theme";

type Props = {
  title: string;
  message?: string;
  actionLabel?: string;
  onAction?: () => void;
  actionVariant?: "primary" | "secondary";
  secondaryActionLabel?: string;
  onSecondaryAction?: () => void;
};

export function EmptyState({
  title,
  message,
  actionLabel,
  onAction,
  actionVariant = "secondary",
  secondaryActionLabel,
  onSecondaryAction,
}: Props) {
  const theme = useTheme();
  return (
    <View
      accessibilityRole="summary"
      style={{
        padding: theme.spacing.xl,
        alignItems: "center",
        backgroundColor: theme.colors.surfaceMuted,
        borderRadius: theme.radius.lg,
        borderWidth: 1,
        borderColor: theme.colors.border,
        borderStyle: "dashed",
      }}
    >
      <Text style={{ color: theme.colors.text, ...theme.typography.headline, textAlign: "center" }}>
        {title}
      </Text>
      {message ? (
        <Text
          style={{
            color: theme.colors.textSecondary,
            ...theme.typography.caption,
            textAlign: "center",
            marginTop: theme.spacing.sm,
          }}
        >
          {message}
        </Text>
      ) : null}
      {actionLabel && onAction ? (
        <View style={{ marginTop: theme.spacing.lg, alignSelf: "stretch", gap: theme.spacing.sm }}>
          <Button label={actionLabel} onPress={onAction} variant={actionVariant} />
          {secondaryActionLabel && onSecondaryAction ? (
            <Button label={secondaryActionLabel} onPress={onSecondaryAction} variant="secondary" />
          ) : null}
        </View>
      ) : null}
    </View>
  );
}
