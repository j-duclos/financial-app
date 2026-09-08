import React from "react";
import { Text, View } from "react-native";
import { GETTING_STARTED_COPY } from "@budget-app/shared";
import { BrandLogo } from "@/components/brand";
import { BottomSheet, Button } from "@/components/ui";
import { useTheme } from "@/theme";

type Props = {
  visible: boolean;
  onGetStarted: () => void;
  onSkip: () => void;
};

export function OnboardingWelcomeSheet({ visible, onGetStarted, onSkip }: Props) {
  const theme = useTheme();
  return (
    <BottomSheet
      visible={visible}
      title={GETTING_STARTED_COPY.welcomeTitle}
      onClose={onSkip}
    >
      <View testID="onboarding-welcome" accessibilityRole="summary">
        <BrandLogo size="small" style={{ marginBottom: theme.spacing.md }} />
        <Text
          style={{
            color: theme.colors.text,
            ...theme.typography.body,
            marginBottom: theme.spacing.sm,
          }}
        >
          {GETTING_STARTED_COPY.welcomeBody}
        </Text>
        <Text
          style={{
            color: theme.colors.textSecondary,
            ...theme.typography.caption,
            marginBottom: theme.spacing.lg,
          }}
        >
          {GETTING_STARTED_COPY.welcomeSecondary}
        </Text>
        <View style={{ gap: theme.spacing.sm }}>
          <Button label={GETTING_STARTED_COPY.welcomeCta} onPress={onGetStarted} />
          <Button
            label={GETTING_STARTED_COPY.welcomeSkip}
            variant="ghost"
            onPress={onSkip}
          />
        </View>
      </View>
    </BottomSheet>
  );
}
