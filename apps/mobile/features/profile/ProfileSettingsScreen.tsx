import React, { useEffect, useMemo, useState } from "react";
import { Alert, Linking, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { updateAccount, updateProfile } from "@budget-app/api-client";
import type { Account } from "@budget-app/shared";
import {
  DEFAULT_OPERATIONAL_FORECAST_DAYS,
  DEFAULT_TARGET_UTILIZATION_PERCENT,
  forecastWindowLabel,
  formatAccountOptionLabel,
  normalizeOperationalForecastDays,
  type OperationalForecastDays,
} from "@budget-app/shared";
import {
  AppHeader,
  BottomSheet,
  Button,
  Card,
  ConfirmDialog,
  Screen,
  SectionHeader,
  SkeletonBlock,
  TextField,
} from "@/components/ui";
import { getApiTargetDisplayLabel, getAppEnvironment } from "@/constants/env";
import {
  getAppVersionLabel,
  getPrivacyPolicyUrl,
  getSupportEmail,
  getTermsUrl,
} from "@/constants/appInfo";
import { useAuth } from "@/features/auth";
import { useAccountOptions } from "@/hooks/useAccountOptions";
import { useDefaultHouseholdId } from "@/hooks/useDefaultHouseholdId";
import { useProfile } from "@/lib/profileQuery";
import { describeApiError } from "@/services/api";
import { invalidateAfterUtilizationTargetChange } from "@/lib/financialQueryRefresh";
import { useTheme } from "@/theme";
import { OptionsPickerSheet } from "@/features/recurring/OptionsPickerSheet";
import { SettingsRow } from "./SettingsRow";
import {
  applyUpdatedProfileCache,
  developmentEnvironmentLabel,
  forecastWindowOptions,
  hasConfiguredLegalLinks,
  invalidateAfterForecastWindowChange,
} from "./profileSettings";

const UTILIZATION_PRESETS = [5, 10, 20, 30] as const;

function parseUtilizationPercent(account: Account): number {
  const raw = account.target_utilization_percent;
  if (raw == null || raw === "") return DEFAULT_TARGET_UTILIZATION_PERCENT;
  const n = parseFloat(String(raw));
  return Number.isFinite(n) ? n : DEFAULT_TARGET_UTILIZATION_PERCENT;
}

function formatUtilization(value: number): string {
  const rounded = Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/\.?0+$/, "");
  return `${rounded}%`;
}

export function ProfileSettingsScreen() {
  const theme = useTheme();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { auth, logout, refreshProfile } = useAuth();
  const { data: profile, isLoading: profileLoading, isFetched } = useProfile();
  const { householdId } = useDefaultHouseholdId();
  const { accounts } = useAccountOptions({ householdId });

  const [confirmLogout, setConfirmLogout] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [forecastPickerOpen, setForecastPickerOpen] = useState(false);
  const [profileEditorOpen, setProfileEditorOpen] = useState(false);
  const [displayNameDraft, setDisplayNameDraft] = useState("");
  const [utilizationAccount, setUtilizationAccount] = useState<Account | null>(null);
  const [customUtilization, setCustomUtilization] = useState("");
  const [customUtilizationOpen, setCustomUtilizationOpen] = useState(false);

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

  const creditAccounts = useMemo(
    () => accounts.filter((a) => a.account_type === "CREDIT"),
    [accounts]
  );

  const privacyUrl = getPrivacyPolicyUrl();
  const termsUrl = getTermsUrl();
  const supportEmail = getSupportEmail();
  const legalConfigured = hasConfiguredLegalLinks({ privacyUrl, termsUrl, supportEmail });

  useEffect(() => {
    if (!profileEditorOpen) return;
    setDisplayNameDraft(profile?.display_name ?? auth.user?.displayName ?? "");
  }, [profileEditorOpen, profile?.display_name, auth.user?.displayName]);

  const forecastMutation = useMutation({
    mutationFn: (days: OperationalForecastDays) =>
      updateProfile({ default_forecast_days: days }),
    onSuccess: async (updated) => {
      applyUpdatedProfileCache(queryClient, updated);
      invalidateAfterForecastWindowChange(queryClient);
      await refreshProfile();
      setForecastPickerOpen(false);
    },
    onError: (err) => {
      setForecastPickerOpen(false);
      Alert.alert("Couldn’t update forecast window", describeApiError(err));
    },
  });

  const displayNameMutation = useMutation({
    mutationFn: (name: string) => updateProfile({ display_name: name.trim() }),
    onSuccess: async (updated) => {
      applyUpdatedProfileCache(queryClient, updated);
      await refreshProfile();
      setProfileEditorOpen(false);
    },
    onError: (err) => {
      Alert.alert("Couldn’t update profile", describeApiError(err));
    },
  });

  const utilizationMutation = useMutation({
    mutationFn: ({ accountId, percent }: { accountId: number; percent: number }) =>
      updateAccount(accountId, {
        target_utilization_percent: String(percent),
      }),
    onSuccess: () => {
      setUtilizationAccount(null);
      setCustomUtilizationOpen(false);
      invalidateAfterUtilizationTargetChange(queryClient);
    },
    onError: (err) => {
      Alert.alert("Couldn’t update utilization target", describeApiError(err));
    },
  });

  const showSkeleton = profileLoading && !isFetched && !auth.profile;

  return (
    <Screen scroll>
      <AppHeader title="Profile & Settings" showBack onBack={() => router.back()} />

      {showSkeleton ? (
        <SkeletonBlock lines={4} />
      ) : (
        <>
          <Card>
            <Text style={{ color: theme.colors.textMuted, ...theme.typography.label }}>Signed in</Text>
            <Text style={{ color: theme.colors.text, ...theme.typography.headline, marginTop: 4 }}>
              {displayName}
            </Text>
            {username ? (
              <Text
                style={{
                  color: theme.colors.textSecondary,
                  ...theme.typography.caption,
                  marginTop: 4,
                }}
              >
                @{username}
              </Text>
            ) : null}
            <SettingsRow
              title="Profile details"
              onPress={() => setProfileEditorOpen(true)}
              accessibilityLabel="Profile details"
            />
          </Card>

          <SectionHeader title="Forecast & planning" />
          <View
            style={{
              backgroundColor: theme.colors.surface,
              borderRadius: theme.radius.md,
              paddingHorizontal: theme.spacing.md,
              borderWidth: 1,
              borderColor: theme.colors.border,
            }}
          >
            <SettingsRow
              title="Default forecast window"
              value={forecastWindowLabel(forecastDays)}
              onPress={() => setForecastPickerOpen(true)}
              accessibilityLabel={`Default forecast window, ${forecastWindowLabel(forecastDays)}`}
              disabled={forecastMutation.isPending}
            />
            {creditAccounts.length === 0 ? (
              <SettingsRow title="Credit utilization target" value="No credit accounts" disabled />
            ) : (
              creditAccounts.map((account) => {
                const pct = parseUtilizationPercent(account);
                return (
                  <SettingsRow
                    key={account.id}
                    title={
                      creditAccounts.length === 1
                        ? "Credit utilization target"
                        : formatAccountOptionLabel(account)
                    }
                    value={formatUtilization(pct)}
                    onPress={() => {
                      setUtilizationAccount(account);
                      setCustomUtilization(String(pct));
                    }}
                    accessibilityLabel={`Credit utilization target, ${formatUtilization(pct)}${
                      creditAccounts.length > 1 ? `, ${formatAccountOptionLabel(account)}` : ""
                    }`}
                    disabled={utilizationMutation.isPending}
                  />
                );
              })
            )}
          </View>
          {creditAccounts.length > 1 ? (
            <Text
              style={{
                color: theme.colors.textMuted,
                ...theme.typography.caption,
                marginTop: 6,
              }}
            >
              Utilization targets are set per credit account.
            </Text>
          ) : null}

          <SectionHeader title="About" />
          <View
            style={{
              backgroundColor: theme.colors.surface,
              borderRadius: theme.radius.md,
              paddingHorizontal: theme.spacing.md,
              borderWidth: 1,
              borderColor: theme.colors.border,
            }}
          >
            <SettingsRow title="Version" value={getAppVersionLabel()} />
            {privacyUrl ? (
              <SettingsRow
                title="Privacy Policy"
                onPress={() => void Linking.openURL(privacyUrl)}
              />
            ) : null}
            {termsUrl ? (
              <SettingsRow title="Terms of Service" onPress={() => void Linking.openURL(termsUrl)} />
            ) : null}
            {supportEmail ? (
              <SettingsRow
                title="Support"
                value={supportEmail}
                onPress={() => void Linking.openURL(`mailto:${supportEmail}`)}
                accessibilityLabel={`Support, ${supportEmail}`}
              />
            ) : null}
            {!legalConfigured ? (
              <Text
                style={{
                  color: theme.colors.textMuted,
                  ...theme.typography.caption,
                  paddingVertical: theme.spacing.sm,
                }}
              >
                Privacy, terms, and support links are not configured for this build.
              </Text>
            ) : null}
          </View>

          {__DEV__ ? (
            <>
              <SectionHeader title="Development" />
              <View
                style={{
                  backgroundColor: theme.colors.surface,
                  borderRadius: theme.radius.md,
                  paddingHorizontal: theme.spacing.md,
                  borderWidth: 1,
                  borderColor: theme.colors.border,
                }}
              >
                <SettingsRow
                  title="Environment"
                  value={developmentEnvironmentLabel({
                    appEnv: getAppEnvironment(),
                    apiTarget: getApiTargetDisplayLabel(),
                  })}
                />
              </View>
            </>
          ) : null}

          <View style={{ marginTop: theme.spacing.xl, marginBottom: theme.spacing.lg }}>
            <Button label="Log out" variant="danger" onPress={() => setConfirmLogout(true)} />
          </View>
        </>
      )}

      <OptionsPickerSheet
        visible={forecastPickerOpen}
        title="Default forecast window"
        selectedId={String(forecastDays)}
        options={forecastWindowOptions().map((opt) => ({
          id: String(opt.value),
          title: opt.label,
        }))}
        onClose={() => setForecastPickerOpen(false)}
        onSelect={(id) => {
          const days = normalizeOperationalForecastDays(Number(id));
          if (days === forecastDays) {
            setForecastPickerOpen(false);
            return;
          }
          forecastMutation.mutate(days);
        }}
      />

      <OptionsPickerSheet
        visible={utilizationAccount != null && !customUtilizationOpen}
        title="Credit utilization target"
        selectedId={
          utilizationAccount ? String(parseUtilizationPercent(utilizationAccount)) : null
        }
        options={[
          ...UTILIZATION_PRESETS.map((p) => ({
            id: String(p),
            title: formatUtilization(p),
          })),
          { id: "custom", title: "Custom…" },
        ]}
        onClose={() => setUtilizationAccount(null)}
        onSelect={(id) => {
          if (!utilizationAccount) return;
          if (id === "custom") {
            setCustomUtilizationOpen(true);
            return;
          }
          const percent = Number(id);
          if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
            Alert.alert("Invalid target", "Enter a percentage between 0 and 100.");
            return;
          }
          utilizationMutation.mutate({ accountId: utilizationAccount.id, percent });
        }}
      />

      <BottomSheet
        visible={profileEditorOpen}
        title="Profile details"
        onClose={() => setProfileEditorOpen(false)}
      >
        {username ? (
          <Text style={{ color: theme.colors.textMuted, marginBottom: 12 }}>
            Username @{username} (read-only)
          </Text>
        ) : null}
        <TextField
          label="Display name"
          value={displayNameDraft}
          onChangeText={setDisplayNameDraft}
          autoCapitalize="words"
        />
        <Button
          label="Save"
          onPress={() => displayNameMutation.mutate(displayNameDraft)}
          loading={displayNameMutation.isPending}
        />
      </BottomSheet>

      <BottomSheet
        visible={customUtilizationOpen && utilizationAccount != null}
        title="Custom utilization target"
        onClose={() => {
          setCustomUtilizationOpen(false);
          setUtilizationAccount(null);
        }}
      >
        <TextField
          label="Target (%)"
          value={customUtilization}
          onChangeText={(v) => setCustomUtilization(v.replace(/[^0-9.]/g, ""))}
          keyboardType="decimal-pad"
          placeholder="10"
        />
        <Button
          label="Save"
          loading={utilizationMutation.isPending}
          onPress={() => {
            if (!utilizationAccount) return;
            const percent = parseFloat(customUtilization);
            if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
              Alert.alert("Invalid target", "Enter a percentage between 0 and 100.");
              return;
            }
            utilizationMutation.mutate({
              accountId: utilizationAccount.id,
              percent: Math.round(percent * 100) / 100,
            });
          }}
        />
      </BottomSheet>

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
