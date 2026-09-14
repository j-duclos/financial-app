import React from "react";
import { Text, View } from "react-native";
import { BottomSheet, Button } from "@/components/ui";
import { useTheme } from "@/theme";
import { LegalInlineLinks } from "./LegalInlineLinks";
import {
  PREMIUM_AUTO_RENEW_STATEMENT,
  PREMIUM_BENEFITS,
  PREMIUM_BILLING_PERIOD_LABEL,
  PREMIUM_CANCEL_STATEMENT_APPLE,
  PREMIUM_CANCEL_STATEMENT_STRIPE,
  PREMIUM_LEGAL_LINKS_PREFIX,
  PREMIUM_MANAGEMENT_UNAVAILABLE_MESSAGE,
  PREMIUM_MONTHLY_PRICE_LABEL,
  PREMIUM_NOT_NOW_LABEL,
  PREMIUM_PRICE_SOURCE_APPLE,
  PREMIUM_PRICE_SOURCE_STRIPE,
  PREMIUM_SHEET_TITLE,
  PREMIUM_SUBSCRIPTION_NAME,
  PREMIUM_UPGRADE_CTA_LABEL,
} from "./premiumUpgradeCopy";

type Props = {
  visible: boolean;
  contextMessage?: string;
  upgrading?: boolean;
  purchaseAvailable: boolean;
  onClose: () => void;
  onUpgrade: () => void;
};

export function PremiumUpgradeSheet({
  visible,
  contextMessage,
  upgrading,
  purchaseAvailable,
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
      {purchaseAvailable ? (
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
      ) : (
        <Text
          style={{
            color: theme.colors.text,
            ...theme.typography.body,
            marginBottom: theme.spacing.md,
          }}
        >
          {PREMIUM_MANAGEMENT_UNAVAILABLE_MESSAGE}
        </Text>
      )}
      <View style={{ gap: 8, marginBottom: theme.spacing.lg }}>
        {PREMIUM_BENEFITS.map((benefit) => (
          <Text key={benefit} style={{ color: theme.colors.textSecondary, ...theme.typography.body }}>
            {`• ${benefit}`}
          </Text>
        ))}
      </View>
      <View style={{ gap: 6, marginBottom: theme.spacing.lg }}>
        <Text style={{ color: theme.colors.textMuted, ...theme.typography.caption }}>
          {PREMIUM_SUBSCRIPTION_NAME}
          {" · "}
          {PREMIUM_BILLING_PERIOD_LABEL}
        </Text>
        <Text style={{ color: theme.colors.textMuted, ...theme.typography.caption }}>
          {purchaseAvailable ? PREMIUM_PRICE_SOURCE_STRIPE : PREMIUM_PRICE_SOURCE_APPLE}
        </Text>
        <Text style={{ color: theme.colors.textMuted, ...theme.typography.caption }}>
          {PREMIUM_AUTO_RENEW_STATEMENT}
        </Text>
        <Text style={{ color: theme.colors.textMuted, ...theme.typography.caption }}>
          {purchaseAvailable ? PREMIUM_CANCEL_STATEMENT_STRIPE : PREMIUM_CANCEL_STATEMENT_APPLE}
        </Text>
        <LegalInlineLinks prefix={PREMIUM_LEGAL_LINKS_PREFIX} />
      </View>
      {purchaseAvailable ? (
        <Button
          label={PREMIUM_UPGRADE_CTA_LABEL}
          onPress={onUpgrade}
          loading={upgrading}
          accessibilityLabel={PREMIUM_UPGRADE_CTA_LABEL}
        />
      ) : null}
      <Button
        label={PREMIUM_NOT_NOW_LABEL}
        variant="secondary"
        onPress={onClose}
        style={{ marginTop: theme.spacing.sm }}
      />
    </BottomSheet>
  );
}
