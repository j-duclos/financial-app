import React from "react";
import { Text, View } from "react-native";
import { BottomSheet, Button } from "@/components/ui";
import { useTheme } from "@/theme";
import { REVIEW_PROMPT_COPY } from "./reviewPromptCopy";

type Props = {
  visible: boolean;
  onYes: () => void;
  onNo: () => void;
  onNotNow: () => void;
};

export function EnjoymentPromptSheet({ visible, onYes, onNo, onNotNow }: Props) {
  const theme = useTheme();
  return (
    <BottomSheet
      visible={visible}
      title={REVIEW_PROMPT_COPY.enjoymentTitle}
      onClose={onNotNow}
      trackPresentation={false}
    >
      <Text style={{ color: theme.colors.textSecondary, ...theme.typography.body, marginBottom: theme.spacing.lg }}>
        {REVIEW_PROMPT_COPY.enjoymentBody}
      </Text>
      <View style={{ gap: theme.spacing.sm }}>
        <Button label={REVIEW_PROMPT_COPY.yesLabel} onPress={onYes} />
        <Button label={REVIEW_PROMPT_COPY.noLabel} variant="secondary" onPress={onNo} />
        <Button label={REVIEW_PROMPT_COPY.notNowLabel} variant="ghost" onPress={onNotNow} />
      </View>
    </BottomSheet>
  );
}
