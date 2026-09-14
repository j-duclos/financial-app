import { useMemo, useState } from "react";
import { KeyboardAvoidingView, Platform, Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { resetPassword } from "@budget-app/api-client";
import { BrandLogo } from "@/components/brand";
import { Button, Screen, TextField } from "@/components/ui";
import {
  RESET_LINK_INVALID_MESSAGE,
  RESET_SUCCESS_MESSAGE,
  describeResetPasswordError,
  parseResetLinkParams,
  resetPasswordClientError,
} from "@/features/auth/passwordReset";
import { useTheme } from "@/theme";

export default function ResetPasswordScreen() {
  const theme = useTheme();
  const params = useLocalSearchParams<{ uid?: string; token?: string }>();
  const parsed = useMemo(() => parseResetLinkParams(params), [params]);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit() {
    if (submitting || !parsed) return;
    const clientError = resetPasswordClientError(password, confirm);
    if (clientError) {
      setError(clientError);
      return;
    }
    setError("");
    setSubmitting(true);
    try {
      await resetPassword({
        uid: parsed.uid,
        token: parsed.token,
        new_password: password,
        new_password_confirm: confirm,
      });
      setDone(true);
    } catch (err: unknown) {
      setError(describeResetPasswordError(err));
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
          Reset password
        </Text>

        {done ? (
          <>
            <Text
              accessibilityLiveRegion="polite"
              style={{
                color: theme.colors.text,
                ...theme.typography.body,
                textAlign: "center",
                marginBottom: theme.spacing.lg,
              }}
            >
              {RESET_SUCCESS_MESSAGE}
            </Text>
            <Button label="Back to sign in" onPress={() => router.replace("/(auth)/login")} />
          </>
        ) : !parsed ? (
          <>
            <Text
              accessibilityLiveRegion="polite"
              style={{
                color: theme.colors.critical,
                ...theme.typography.body,
                textAlign: "center",
                marginBottom: theme.spacing.lg,
              }}
            >
              {RESET_LINK_INVALID_MESSAGE}
            </Text>
            <Button
              label="Forgot password?"
              onPress={() => router.replace("/(auth)/forgot-password")}
            />
            <View style={{ marginTop: theme.spacing.md, alignItems: "center" }}>
              <Button
                label="Back to sign in"
                variant="ghost"
                onPress={() => router.replace("/(auth)/login")}
              />
            </View>
          </>
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
              label="New password"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              textContentType="newPassword"
              autoComplete="password-new"
              returnKeyType="next"
            />
            <TextField
              label="Confirm password"
              value={confirm}
              onChangeText={setConfirm}
              secureTextEntry
              textContentType="newPassword"
              autoComplete="password-new"
              returnKeyType="go"
              onSubmitEditing={() => {
                void handleSubmit();
              }}
            />
            <Button
              label="Reset password"
              onPress={() => void handleSubmit()}
              loading={submitting}
            />
            {error === RESET_LINK_INVALID_MESSAGE ? (
              <View style={{ marginTop: theme.spacing.md, alignItems: "center" }}>
                <Button
                  label="Forgot password?"
                  variant="ghost"
                  onPress={() => router.replace("/(auth)/forgot-password")}
                />
              </View>
            ) : null}
          </>
        )}
      </KeyboardAvoidingView>
    </Screen>
  );
}
