import React from "react";
import { Text } from "react-native";
import {
  PAYMENT_PLANNER_FULL_UPSELL_BODY,
  PAYMENT_PLANNER_FULL_UPSELL_TITLE,
} from "@budget-app/shared";
import { Button, Card } from "@/components/ui";
import { UPGRADE_TO_PREMIUM_LABEL } from "@/lib/billing";
import { useTheme } from "@/theme";

type Props = {
  onUpgrade: () => void;
};

export function PremiumUpsellCard({ onUpgrade }: Props) {
  const theme = useTheme();
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
        {PAYMENT_PLANNER_FULL_UPSELL_BODY}
      </Text>
      <Button label={UPGRADE_TO_PREMIUM_LABEL} onPress={onUpgrade} />
    </Card>
  );
}
