import { useState } from "react";
import { KeyboardAvoidingView, Platform, Text, View } from "react-native";
import { router } from "expo-router";
import { BrandLogo } from "@/components/brand";
import { Button, Screen, TextField } from "@/components/ui";
import {
  NEUTRAL_PASSWORD_RESET_DETAIL,
  RESET_EMAIL_NEXT_STEP,
  describeForgotPasswordError,
  isValidResetEmail,
  normalizeResetEmail,
} from "@/features/auth/passwordReset";
import { forgotPassword } from "@budget-app/api-client";
import { useTheme } from "@/theme";

export default function ForgotPasswordScreen() {
  const theme = useTheme();
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit() {
    if (submitting) return;
    setError("");
    const normalized = normalizeResetEmail(email);
    if (!isValidResetEmail(normalized)) {
      setError("Enter a valid email address.");
      return;
    }
    setSubmitting(true);
    try {
      await forgotPassword(normalized);
      setSubmitted(true);
    } catch (err: unknown) {
      setError(describeForgotPasswordError(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Screen>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={{ flex: 1, justifyContent: "center" }}
      >
        <BrandLogo size="large" style={{ marginBottom: theme.spacing.sm }} />
        <Text
          style={{
            color: theme.colors.text,
            ...theme.typography.title,
            textAlign: "center",
            marginBottom: theme.spacing.md,
          }}
        >
          Forgot password?
        </Text>

        {submitted ? (
          <View style={{ marginBottom: theme.spacing.lg }}>
            <Text
              accessibilityLiveRegion="polite"
              style={{
                color: theme.colors.text,
                ...theme.typography.body,
                textAlign: "center",
                marginBottom: theme.spacing.md,
              }}
            >
              {NEUTRAL_PASSWORD_RESET_DETAIL}
            </Text>
            <Text
              style={{
                color: theme.colors.textMuted,
                ...theme.typography.caption,
                textAlign: "center",
              }}
            >
              {RESET_EMAIL_NEXT_STEP}
            </Text>
          </View>
        ) : (
          <>
            {error ? (
              <Text
                accessibilityLiveRegion="polite"
                style={{
                  color: theme.colors.critical,
                  marginBottom: theme.spacing.md,
                  textAlign: "center",
                }}
              >
                {error}
              </Text>
            ) : null}
            <TextField
              label="Email"
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              textContentType="emailAddress"
              autoComplete="email"
              returnKeyType="go"
              onSubmitEditing={() => {
                void handleSubmit();
              }}
            />
            <Button
              label="Send reset instructions"
              onPress={() => void handleSubmit()}
              loading={submitting}
            />
          </>
        )}

        <View style={{ marginTop: theme.spacing.lg, alignItems: "center" }}>
          <Button
            label="Back to sign in"
            variant="ghost"
            onPress={() => router.replace("/(auth)/login")}
          />
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}
