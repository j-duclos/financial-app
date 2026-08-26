import React from "react";
import { Text, View } from "react-native";
import { EmptyState } from "@/components/ui";
import { useTheme } from "@/theme";

type Props = {
  title: string;
  message: string;
};

export function ReportEmptyState({ title, message }: Props) {
  return <EmptyState title={title} message={message} />;
}

export function ReportSectionHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  const theme = useTheme();
  return (
    <View style={{ marginBottom: theme.spacing.sm }}>
      <Text
        style={{ color: theme.colors.text, ...theme.typography.headline }}
        accessibilityRole="header"
      >
        {title}
      </Text>
      {subtitle ? (
        <Text style={{ color: theme.colors.textSecondary, fontSize: 13, marginTop: 4 }}>{subtitle}</Text>
      ) : null}
    </View>
  );
}
