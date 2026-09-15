import React from "react";
import { Text, View } from "react-native";
import { Button, Card } from "@/components/ui";
import { useTheme } from "@/theme";
import { useEmailVerificationActions } from "./useEmailVerificationActions";
import {
  REFRESH_STATUS_LABEL,
  RESEND_EMAIL_LABEL,
  VERIFY_EMAIL_TITLE,
  verifyEmailReminderBody,
} from "./emailVerification";

type Props = {
  email: string;
};

export function EmailVerificationReminderCard({ email }: Props) {
  const theme = useTheme();
  const { resend, refreshStatus, resending, refreshingStatus, pending } =
    useEmailVerificationActions();

  return (
    <Card testID="email-verification-reminder" style={{ marginBottom: theme.spacing.md }}>
      <Text
        accessibilityRole="header"
        style={{ color: theme.colors.text, ...theme.typography.headline }}
      >
        {VERIFY_EMAIL_TITLE}
      </Text>
      <Text
        style={{
          color: theme.colors.textSecondary,
          ...theme.typography.caption,
          marginTop: theme.spacing.sm,
          marginBottom: theme.spacing.md,
        }}
      >
        {verifyEmailReminderBody(email.trim())}
      </Text>
      <View style={{ gap: theme.spacing.sm }}>
        <Button
          label={RESEND_EMAIL_LABEL}
          variant="secondary"
          loading={resending}
          disabled={pending}
          onPress={() => void resend()}
        />
        <Button
          label={REFRESH_STATUS_LABEL}
          variant="ghost"
          loading={refreshingStatus}
          disabled={pending}
          onPress={() => void refreshStatus()}
        />
      </View>
    </Card>
  );
}
