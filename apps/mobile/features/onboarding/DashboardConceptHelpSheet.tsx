import React from "react";
import { GETTING_STARTED_COPY, GETTING_STARTED_HELP_LABELS, type GettingStartedHelpTopic } from "@budget-app/shared";
import { BottomSheet } from "@/components/ui";
import { Text } from "react-native";
import { useTheme } from "@/theme";

type Props = {
  topic: GettingStartedHelpTopic | null;
  onClose: () => void;
};

export function DashboardConceptHelpSheet({ topic, onClose }: Props) {
  const theme = useTheme();
  const title = topic ? GETTING_STARTED_HELP_LABELS[topic] : undefined;
  const body = topic ? GETTING_STARTED_COPY.help[topic] : "";
  return (
    <BottomSheet visible={topic != null} title={title} onClose={onClose}>
      <Text style={{ color: theme.colors.textSecondary, ...theme.typography.body }}>{body}</Text>
    </BottomSheet>
  );
}
