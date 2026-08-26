import { useState } from "react";
import { Text, View } from "react-native";
import { useRouter } from "expo-router";
import {
  AppHeader,
  Button,
  Card,
  ConfirmDialog,
  Screen,
} from "@/components/ui";
import { useAuth } from "@/features/auth";
import { useTheme } from "@/theme";
import {
  DEFAULT_OPERATIONAL_FORECAST_DAYS,
  forecastWindowLabel,
  normalizeOperationalForecastDays,
} from "@budget-app/shared";

export default function ProfileScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { auth, logout } = useAuth();
  const [confirmLogout, setConfirmLogout] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  const forecastDays = normalizeOperationalForecastDays(
    auth.profile?.default_forecast_days ?? DEFAULT_OPERATIONAL_FORECAST_DAYS
  );

  return (
    <Screen scroll>
      <AppHeader title="Profile & Settings" onBack={() => router.back()} />
      <Card>
        <Text style={{ color: theme.colors.textMuted, ...theme.typography.label }}>Signed in</Text>
        <Text style={{ color: theme.colors.text, ...theme.typography.headline, marginTop: 4 }}>
          {auth.user?.displayName ?? auth.user?.username ?? "—"}
        </Text>
        {auth.user?.username ? (
          <Text style={{ color: theme.colors.textSecondary, ...theme.typography.caption, marginTop: 4 }}>
            @{auth.user.username}
          </Text>
        ) : null}
      </Card>

      <Card style={{ marginTop: theme.spacing.md }}>
        <Text style={{ color: theme.colors.textMuted, ...theme.typography.label }}>
          Default forecast window
        </Text>
        <Text style={{ color: theme.colors.text, ...theme.typography.bodyStrong, marginTop: 4 }}>
          {forecastWindowLabel(forecastDays)}
        </Text>
        <Text style={{ color: theme.colors.textMuted, ...theme.typography.caption, marginTop: 6 }}>
          Used as the default on Dashboard, Action Center, and Transactions. Change it on web Settings for
          now; mobile editing lands in a later pass.
        </Text>
      </Card>

      <View style={{ marginTop: theme.spacing.xl }}>
        <Button label="Log out" variant="danger" onPress={() => setConfirmLogout(true)} />
      </View>

      <ConfirmDialog
        visible={confirmLogout}
        title="Log out?"
        message="You will need to sign in again to view your finances."
        confirmLabel="Log out"
        destructive
        loading={loggingOut}
        onCancel={() => setConfirmLogout(false)}
        onConfirm={async () => {
          setLoggingOut(true);
          try {
            await logout();
            router.replace("/(auth)/login");
          } finally {
            setLoggingOut(false);
            setConfirmLogout(false);
          }
        }}
      />
    </Screen>
  );
}
