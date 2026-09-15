import React from "react";
import { Text, View } from "react-native";
import { Button, Card } from "@/components/ui";
import { useTheme } from "@/theme";
import { useEmailVerificationActions } from "./useEmailVerificationActions";
import {
  ACCOUNT_CREATED_TITLE,
  CONTINUE_LABEL,
  RESEND_EMAIL_LABEL,
  accountCreatedBody,
} from "./emailVerification";

type Props = {
  email: string;
  onContinue: () => void;
};

export function RegistrationSuccessPanel({ email, onContinue }: Props) {
  const theme = useTheme();
  const { resend, resending, pending } = useEmailVerificationActions();
  const address = email.trim();

  return (
    <Card testID="registration-success">
      <Text
        accessibilityRole="header"
        style={{
          color: theme.colors.text,
          ...theme.typography.title,
          textAlign: "center",
          marginBottom: theme.spacing.md,
        }}
      >
        {ACCOUNT_CREATED_TITLE}
      </Text>
      <Text
        style={{
          color: theme.colors.textSecondary,
          ...theme.typography.body,
          textAlign: "center",
          marginBottom: theme.spacing.lg,
        }}
      >
        {accountCreatedBody(address)}
      </Text>
      <View style={{ gap: theme.spacing.sm }}>
        <Button label={CONTINUE_LABEL} onPress={onContinue} disabled={pending} />
        <Button
          label={RESEND_EMAIL_LABEL}
          variant="secondary"
          loading={resending}
          disabled={pending}
          onPress={() => void resend()}
        />
      </View>
    </Card>
  );
}
