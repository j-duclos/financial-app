import { useState } from "react";
import { Linking, Text, View } from "react-native";
import { useRouter } from "expo-router";
import {
  AppHeader,
  Button,
  Card,
  ConfirmDialog,
  Screen,
} from "@/components/ui";
import { getApiTargetDisplayLabel, getAppEnvironment } from "@/constants/env";
import {
  getAppVersionLabel,
  getPrivacyPolicyUrl,
  getSupportEmail,
  getTermsUrl,
} from "@/constants/appInfo";
import { useAuth } from "@/features/auth";
import { useProfile } from "@/lib/profileQuery";
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
  const { data: profile } = useProfile();
  const [confirmLogout, setConfirmLogout] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  const forecastDays = normalizeOperationalForecastDays(
    profile?.default_forecast_days ??
      auth.profile?.default_forecast_days ??
      DEFAULT_OPERATIONAL_FORECAST_DAYS
  );

  const displayName =
    auth.user?.displayName ??
    (profile?.display_name?.trim() || profile?.username) ??
    auth.user?.username ??
    "—";
  const username = auth.user?.username ?? profile?.username;

  const privacyUrl = getPrivacyPolicyUrl();
  const termsUrl = getTermsUrl();
  const supportEmail = getSupportEmail();

  return (
    <Screen scroll>
      <AppHeader title="Profile & Settings" onBack={() => router.back()} />
      <Card>
        <Text style={{ color: theme.colors.textMuted, ...theme.typography.label }}>Signed in</Text>
        <Text style={{ color: theme.colors.text, ...theme.typography.headline, marginTop: 4 }}>
          {displayName}
        </Text>
        {username ? (
          <Text style={{ color: theme.colors.textSecondary, ...theme.typography.caption, marginTop: 4 }}>
            @{username}
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

      <Card style={{ marginTop: theme.spacing.md }}>
        <Text style={{ color: theme.colors.textMuted, ...theme.typography.label }}>About</Text>
        <Text style={{ color: theme.colors.text, ...theme.typography.bodyStrong, marginTop: 4 }}>
          Version {getAppVersionLabel()}
        </Text>
        {__DEV__ ? (
          <Text style={{ color: theme.colors.textMuted, ...theme.typography.caption, marginTop: 6 }}>
            Environment: {getAppEnvironment()} · API: {getApiTargetDisplayLabel()}
          </Text>
        ) : null}
        {supportEmail ? (
          <Button
            label={`Contact support (${supportEmail})`}
            variant="ghost"
            style={{ marginTop: theme.spacing.sm, alignSelf: "flex-start" }}
            onPress={() => void Linking.openURL(`mailto:${supportEmail}`)}
          />
        ) : null}
        {privacyUrl ? (
          <Button
            label="Privacy Policy"
            variant="ghost"
            style={{ marginTop: theme.spacing.xs, alignSelf: "flex-start" }}
            onPress={() => void Linking.openURL(privacyUrl)}
          />
        ) : null}
        {termsUrl ? (
          <Button
            label="Terms of Service"
            variant="ghost"
            style={{ marginTop: theme.spacing.xs, alignSelf: "flex-start" }}
            onPress={() => void Linking.openURL(termsUrl)}
          />
        ) : null}
        {!privacyUrl && !termsUrl && !supportEmail ? (
          <Text style={{ color: theme.colors.textMuted, ...theme.typography.caption, marginTop: 6 }}>
            Legal and support links can be configured via EXPO_PUBLIC_PRIVACY_URL, EXPO_PUBLIC_TERMS_URL, and
            EXPO_PUBLIC_SUPPORT_EMAIL for beta builds.
          </Text>
        ) : null}
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
