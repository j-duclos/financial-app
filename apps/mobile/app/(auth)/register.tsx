import { useState } from "react";
import { KeyboardAvoidingView, Platform, Text, View } from "react-native";
import { router } from "expo-router";
import { Button, Screen, TextField } from "@/components/ui";
import { useAuth } from "@/features/auth";
import { describeApiError } from "@/services/api";
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
    if (!username.trim() || !password) {
      setError("Username and password are required.");
      return;
    }
    setSubmitting(true);
    try {
      await register(username, password, email.trim() || undefined);
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
        <Text style={{ color: theme.colors.text, ...theme.typography.title, textAlign: "center", marginBottom: 16 }}>
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
        />
        <TextField
          label="Email (optional)"
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          keyboardType="email-address"
        />
        <TextField label="Password" value={password} onChangeText={setPassword} secureTextEntry />
        <Button label="Sign up" onPress={() => void handleSubmit()} loading={submitting} />
        <View style={{ marginTop: 16 }}>
          <Button label="Back to sign in" variant="ghost" onPress={() => router.back()} />
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}
