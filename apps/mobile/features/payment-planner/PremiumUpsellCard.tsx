import React from "react";
import { Text } from "react-native";
import {
  PAYMENT_PLANNER_FULL_UPSELL_BODY,
  PAYMENT_PLANNER_FULL_UPSELL_TITLE,
} from "@budget-app/shared";
import { Button, Card } from "@/components/ui";
import { canOfferStripePremiumPurchase } from "@/features/billing/billingProvider";
import {
  PREMIUM_MANAGEMENT_UNAVAILABLE_MESSAGE,
  premiumRequiredActionLabel,
} from "@/features/billing/premiumUpgradeCopy";
import { useTheme } from "@/theme";

type Props = {
  onUpgrade: () => void;
};

export function PremiumUpsellCard({ onUpgrade }: Props) {
  const theme = useTheme();
  const canPurchase = canOfferStripePremiumPurchase();
  return (
    <Card style={{ marginTop: theme.spacing.sm, marginBottom: theme.spacing.md }}>
      <Text style={{ color: theme.colors.text, ...theme.typography.headline }}>
        {PAYMENT_PLANNER_FULL_UPSELL_TITLE}
      </Text>
      <Text
        style={{
          color: theme.colors.textSecondary,
          ...theme.typography.caption,
          marginTop: 6,
          marginBottom: theme.spacing.md,
        }}
      >
        {canPurchase ? PAYMENT_PLANNER_FULL_UPSELL_BODY : PREMIUM_MANAGEMENT_UNAVAILABLE_MESSAGE}
      </Text>
      <Button
        label={premiumRequiredActionLabel(canPurchase)}
        onPress={onUpgrade}
      />
    </Card>
  );
}
