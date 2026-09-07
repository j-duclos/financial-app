import React from "react";
import { Text, View } from "react-native";
import { BottomSheet, Button } from "@/components/ui";
import { useTheme } from "@/theme";
import { REVIEW_PROMPT_COPY } from "./reviewPromptCopy";

type Props = {
  visible: boolean;
  onLeaveReview: () => void;
  onMaybeLater: () => void;
};

export function ReviewRequestSheet({ visible, onLeaveReview, onMaybeLater }: Props) {
  const theme = useTheme();
  return (
    <BottomSheet
      visible={visible}
      title={REVIEW_PROMPT_COPY.reviewTitle}
      onClose={onMaybeLater}
      trackPresentation={false}
    >
      <Text style={{ color: theme.colors.textSecondary, ...theme.typography.body, marginBottom: theme.spacing.lg }}>
        {REVIEW_PROMPT_COPY.reviewBody}
      </Text>
      <View style={{ gap: theme.spacing.sm }}>
        <Button label={REVIEW_PROMPT_COPY.leaveReviewLabel} onPress={onLeaveReview} />
        <Button label={REVIEW_PROMPT_COPY.maybeLaterLabel} variant="ghost" onPress={onMaybeLater} />
      </View>
    </BottomSheet>
  );
}
