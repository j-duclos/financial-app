import React from "react";
import { Alert, Linking, Text, View } from "react-native";
import {
  APP_WEB_COMPANION_MESSAGE,
  APP_WEB_URL,
  FREE_PLAN_LIMITS,
  GETTING_STARTED_COPY,
  PLAID_PREMIUM_MESSAGE,
} from "@budget-app/shared";
import { BrandLogo } from "@/components/brand";
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
      <BrandLogo size="small" style={{ marginBottom: theme.spacing.md }} />
      <Text style={{ color: theme.colors.text, ...theme.typography.headline, textAlign: "center" }}>
        {GETTING_STARTED_COPY.welcomeTitle}
      </Text>
      <Text
        style={{
          color: theme.colors.textSecondary,
          ...theme.typography.caption,
          textAlign: "center",
          marginTop: theme.spacing.sm,
        }}
      >
        {GETTING_STARTED_COPY.welcomeBody}
      </Text>
      <Text
        style={{
          color: theme.colors.textSecondary,
          ...theme.typography.caption,
          textAlign: "center",
          marginTop: theme.spacing.sm,
        }}
      >
        {GETTING_STARTED_COPY.welcomeSecondary}
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
      <Text
        style={{
          color: theme.colors.textMuted,
          ...theme.typography.caption,
          textAlign: "center",
          marginTop: theme.spacing.lg,
        }}
      >
        {APP_WEB_COMPANION_MESSAGE}
      </Text>
      <Button
        label="Open FlowSight on the web"
        variant="ghost"
        onPress={() => void Linking.openURL(APP_WEB_URL)}
        style={{ marginTop: theme.spacing.xs }}
      />
    </View>
  );
}
