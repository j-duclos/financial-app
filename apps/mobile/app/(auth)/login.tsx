import { useState } from "react";
import { KeyboardAvoidingView, Platform, Text, View } from "react-native";
import { router } from "expo-router";
import { Button, Screen, TextField } from "@/components/ui";
import { useAuth } from "@/features/auth";
import { describeApiError } from "@/services/api";
import { getApiBaseUrl, getApiConnectivityHint } from "@/constants/env";
import { useTheme } from "@/theme";

export default function LoginScreen() {
  const theme = useTheme();
  const { login } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit() {
    if (submitting) return;
    setError("");
    if (!username.trim() || !password) {
      setError("Enter your username and password.");
      return;
    }
    setSubmitting(true);
    try {
      await login(username, password);
      router.replace("/(app)/(tabs)");
    } catch (e: unknown) {
      setError(describeApiError(e));
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
        <Text style={{ color: theme.colors.text, ...theme.typography.display, textAlign: "center" }}>
          Budget
        </Text>
        <Text
          style={{
            color: theme.colors.textMuted,
            ...theme.typography.caption,
            textAlign: "center",
            marginBottom: theme.spacing.xl,
            marginTop: 4,
          }}
        >
          Sign in to your household finances
        </Text>

        {error ? (
          <Text
            accessibilityLiveRegion="polite"
            style={{ color: theme.colors.critical, marginBottom: theme.spacing.md, textAlign: "center" }}
          >
            {error}
            {__DEV__ && /network unavailable/i.test(error) ? (
              `\n\nAPI: ${getApiBaseUrl()}\nIs Django running on your Mac?`
            ) : (
              ""
            )}
          </Text>
        ) : null}

        {__DEV__ ? (
          <Text
            style={{
              color: theme.colors.textMuted,
              ...theme.typography.caption,
              textAlign: "center",
              marginBottom: theme.spacing.md,
            }}
          >
            {getApiConnectivityHint()}
          </Text>
        ) : null}

        <TextField
          label="Username"
          value={username}
          onChangeText={setUsername}
          autoCapitalize="none"
          autoCorrect={false}
          textContentType="username"
          autoComplete="username"
          returnKeyType="next"
        />
        <TextField
          label="Password"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          textContentType="password"
          autoComplete="password"
          returnKeyType="go"
          onSubmitEditing={() => {
            void handleSubmit();
          }}
        />

        <Button label="Log in" onPress={() => void handleSubmit()} loading={submitting} />

        <View style={{ marginTop: theme.spacing.lg, alignItems: "center" }}>
          <Button
            label="Create an account"
            variant="ghost"
            onPress={() => router.push("/(auth)/register")}
          />
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}
