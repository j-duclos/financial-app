import { useState } from "react";
import { Text, View } from "react-native";
import { router } from "expo-router";
import { BrandLogo } from "@/components/brand";
import { Button, Screen, TextField } from "@/components/ui";
import { APP_TAGLINE } from "@budget-app/shared";
import { useAuth } from "@/features/auth";
import { LegalInlineLinks } from "@/features/billing/LegalInlineLinks";
import { describeAuthFormError } from "@/services/api";
import { useTheme } from "@/theme";

export default function RegisterScreen() {
  const theme = useTheme();
  const { register } = useAuth();
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit() {
    if (submitting) return;
    setError("");
    if (!username.trim() || !email.trim() || !password) {
      setError("Username, email, and password are required.");
      return;
    }
    setSubmitting(true);
    try {
      await register(username, password, email.trim());
      router.replace("/(app)/(tabs)");
    } catch (e: unknown) {
      setError(describeAuthFormError(e));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Screen scroll edges={["top", "left", "right", "bottom"]}>
      <BrandLogo size="small" style={{ marginBottom: 8, alignSelf: "center" }} />
      <Text
        style={{
          color: theme.colors.textMuted,
          ...theme.typography.caption,
          textAlign: "center",
          marginBottom: 8,
        }}
      >
        {APP_TAGLINE}
      </Text>
      <Text style={{ color: theme.colors.text, ...theme.typography.title, textAlign: "center", marginBottom: 12 }}>
        Create account
      </Text>
      {error ? (
        <Text style={{ color: theme.colors.critical, marginBottom: 12, textAlign: "center" }}>{error}</Text>
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
        label="Email"
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="email-address"
        textContentType="emailAddress"
        autoComplete="email"
        returnKeyType="next"
      />
      <TextField
        label="Password"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        textContentType="newPassword"
        autoComplete="password-new"
        returnKeyType="go"
        onSubmitEditing={() => {
          void handleSubmit();
        }}
      />
      <View style={{ marginBottom: 12 }}>
        <LegalInlineLinks />
      </View>
      <Button label="Sign up" onPress={() => void handleSubmit()} loading={submitting} />
      <View style={{ marginTop: 16, marginBottom: 24 }}>
        <Button label="Back to sign in" variant="ghost" onPress={() => router.back()} />
      </View>
    </Screen>
  );
}
