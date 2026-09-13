import React from "react";
import { Text, View } from "react-native";
import { BottomSheet, Button } from "@/components/ui";
import { useTheme } from "@/theme";

type Props = {
  visible: boolean;
  title: string;
  body: string;
  primaryLabel: string;
  onPrimary: () => void;
  secondaryLabel?: string;
  onSecondary?: () => void;
  /** Overlay / back dismiss. Defaults to primary so swipe-away does not fire a navigation CTA. */
  onClose?: () => void;
  /** In-tree sheet (no RN Modal). Required before navigating to another tab. */
  embedded?: boolean;
  testID?: string;
};

export function OnboardingEducationSheet({
  visible,
  title,
  body,
  primaryLabel,
  onPrimary,
  secondaryLabel,
  onSecondary,
  onClose,
  embedded,
  testID,
}: Props) {
  const theme = useTheme();
  return (
    <BottomSheet visible={visible} title={title} onClose={onClose ?? onPrimary} embedded={embedded}>
      <View testID={testID}>
        <Text
          style={{
            color: theme.colors.textSecondary,
            ...theme.typography.body,
            marginBottom: theme.spacing.lg,
          }}
        >
          {body}
        </Text>
        <View style={{ gap: theme.spacing.sm }}>
          <Button label={primaryLabel} onPress={onPrimary} />
          {secondaryLabel && onSecondary ? (
            <Button label={secondaryLabel} variant="ghost" onPress={onSecondary} />
          ) : null}
        </View>
      </View>
    </BottomSheet>
  );
}
