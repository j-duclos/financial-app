import React from "react";
import { Text, View } from "react-native";
import { Button } from "./Button";
import { useTheme } from "@/theme";

type Props = {
  title?: string;
  message: string;
  onRetry?: () => void;
};

export function ErrorState({ title = "Something went wrong", message, onRetry }: Props) {
  const theme = useTheme();
  return (
    <View
      accessibilityRole="alert"
      style={{
        padding: theme.spacing.lg,
        backgroundColor: theme.colors.criticalBg,
        borderRadius: theme.radius.lg,
        borderWidth: 1,
        borderColor: theme.colors.critical,
      }}
    >
      <Text style={{ color: theme.colors.critical, ...theme.typography.bodyStrong }}>{title}</Text>
      <Text style={{ color: theme.colors.text, ...theme.typography.caption, marginTop: 6 }}>
        {message}
      </Text>
      {onRetry ? (
        <View style={{ marginTop: theme.spacing.md }}>
          <Button label="Try again" onPress={onRetry} variant="secondary" />
        </View>
      ) : null}
    </View>
  );
}
