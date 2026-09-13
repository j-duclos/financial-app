import React from "react";
import { Text, View } from "react-native";
import { BottomSheet, Button } from "@/components/ui";
import { useTheme } from "@/theme";
import {
  PREMIUM_BENEFITS,
  PREMIUM_MONTHLY_PRICE_LABEL,
  PREMIUM_NOT_NOW_LABEL,
  PREMIUM_SHEET_TITLE,
  PREMIUM_UPGRADE_CTA_LABEL,
} from "./premiumUpgradeCopy";

type Props = {
  visible: boolean;
  contextMessage?: string;
  upgrading?: boolean;
  onClose: () => void;
  onUpgrade: () => void;
};

export function PremiumUpgradeSheet({
  visible,
  contextMessage,
  upgrading,
  onClose,
  onUpgrade,
}: Props) {
  const theme = useTheme();

  return (
    <BottomSheet visible={visible} title={PREMIUM_SHEET_TITLE} onClose={onClose}>
      {contextMessage ? (
        <Text
          style={{
            color: theme.colors.text,
            ...theme.typography.body,
            marginBottom: theme.spacing.sm,
          }}
        >
          {contextMessage}
        </Text>
      ) : null}
      <Text
        style={{
          color: theme.colors.tint,
          fontWeight: "700",
          fontSize: 16,
          marginBottom: theme.spacing.md,
        }}
      >
        {PREMIUM_MONTHLY_PRICE_LABEL}
      </Text>
      <View style={{ gap: 8, marginBottom: theme.spacing.lg }}>
        {PREMIUM_BENEFITS.map((benefit) => (
          <Text key={benefit} style={{ color: theme.colors.textSecondary, ...theme.typography.body }}>
            {`• ${benefit}`}
          </Text>
        ))}
      </View>
      <Button
        label={PREMIUM_UPGRADE_CTA_LABEL}
        onPress={onUpgrade}
        loading={upgrading}
        accessibilityLabel={PREMIUM_UPGRADE_CTA_LABEL}
      />
      <Button
        label={PREMIUM_NOT_NOW_LABEL}
        variant="secondary"
        onPress={onClose}
        style={{ marginTop: theme.spacing.sm }}
      />
    </BottomSheet>
  );
}
