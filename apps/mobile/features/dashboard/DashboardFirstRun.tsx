import React from "react";
import { Alert, Text, View } from "react-native";
import { FREE_PLAN_LIMITS, PLAID_PREMIUM_MESSAGE } from "@budget-app/shared";
import { Button } from "@/components/ui";
import { useTheme } from "@/theme";
import { BANK_SYNC_WEB_MESSAGE } from "@/lib/billing";

type Props = {
  isPremium: boolean;
  onAddAccount: () => void;
  onUpgrade: () => void;
};

export function DashboardFirstRun({ isPremium, onAddAccount, onUpgrade }: Props) {
  const theme = useTheme();

  return (
    <View
      testID="dashboard-first-run"
      accessibilityRole="summary"
      style={{
        padding: theme.spacing.xl,
        backgroundColor: theme.colors.surfaceMuted,
        borderRadius: theme.radius.lg,
        borderWidth: 1,
        borderColor: theme.colors.border,
        borderStyle: "dashed",
      }}
    >
      <Text style={{ color: theme.colors.text, ...theme.typography.headline, textAlign: "center" }}>
        Build your first forecast
      </Text>
      <Text
        style={{
          color: theme.colors.textSecondary,
          ...theme.typography.caption,
          textAlign: "center",
          marginTop: theme.spacing.sm,
        }}
      >
        Add an account and recurring income or bills to see where your balance is headed.
      </Text>
      <View style={{ marginTop: theme.spacing.lg, gap: theme.spacing.sm }}>
        <Button label="Add account manually" onPress={onAddAccount} />
        {isPremium ? (
          <Button
            label="Connect bank"
            variant="secondary"
            onPress={() => Alert.alert("Connect bank", BANK_SYNC_WEB_MESSAGE)}
          />
        ) : (
          <Button
            label="Upgrade for automatic bank syncing"
            variant="secondary"
            onPress={onUpgrade}
          />
        )}
      </View>
      {!isPremium ? (
        <Text
          style={{
            color: theme.colors.textMuted,
            ...theme.typography.caption,
            textAlign: "center",
            marginTop: theme.spacing.md,
          }}
        >
          Free accounts can track up to {FREE_PLAN_LIMITS.manual_accounts} manually managed
          accounts. {PLAID_PREMIUM_MESSAGE}
        </Text>
      ) : null}
    </View>
  );
}
