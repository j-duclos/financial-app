import React, { useEffect, useMemo, useState } from "react";
import { Alert, Linking, Switch, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  exportProfileData,
  exportTransactionsCsv,
  setTestPlanOverride,
  updateAccount,
  updateProfile,
} from "@budget-app/api-client";
import type { Account } from "@budget-app/shared";
import {
  APP_NAME,
  APP_WEB_HOST,
  APP_WEB_URL,
  DEFAULT_OPERATIONAL_FORECAST_DAYS,
  DEFAULT_TARGET_UTILIZATION_PERCENT,
  clampForecastDaysForPlan,
  canShowPlanTestControls,
  choiceToTestPlanOverride,
  effectivePlanLabel,
  forecastWindowLabel,
  formatAccountOptionLabel,
  isForecastDaysAllowed,
  lockedForecastUpsellMessage,
  normalizeOperationalForecastDays,
  simulatedPlanChoice,
  simulatedPlanChoiceLabel,
  type OperationalForecastDays,
  type SimulatedPlanChoice,
} from "@budget-app/shared";
import { BrandLogo } from "@/components/brand";
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
import { ONBOARDING_STATUS_QUERY_KEY } from "@/lib/billing";
import { resetGettingStartedEducation } from "@/features/onboarding/gettingStartedStorage";
import {
  getAppVersionLabel,
  getPrivacyPolicyUrl,
  getSupportEmail,
  getTermsUrl,
} from "@/constants/appInfo";
import { useAuth } from "@/features/auth";
import { useReviewFeedback } from "@/features/review";
import { useAccountOptions } from "@/hooks/useAccountOptions";
import { useDefaultHouseholdId } from "@/hooks/useDefaultHouseholdId";
import { useBillingStatus } from "@/hooks/useBillingStatus";
import { usePremiumUpgrade } from "@/hooks/usePremiumUpgrade";
import { useProfile } from "@/lib/profileQuery";
import { describeApiError } from "@/services/api";
import { invalidateAfterUtilizationTargetChange } from "@/lib/financialQueryRefresh";
import { useTheme } from "@/theme";
import { OptionsPickerSheet } from "@/components/forms";
import { SettingsRow } from "./SettingsRow";
import { EmailSettingsSheet } from "./EmailSettingsSheet";
import { PasswordSettingsSheet } from "./PasswordSettingsSheet";
import { DeleteAccountSheet } from "./DeleteAccountSheet";
import { shareAuthenticatedFile } from "./profileExport";
import {
  applyUpdatedProfileCache,
  developmentEnvironmentLabel,
  emailSettingsRow,
  forecastWindowPickerOptions,
  hasConfiguredLegalLinks,
  invalidateAfterForecastWindowChange,
  invalidateAfterTestPlanChange,
  profileEmailDisplay,
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

function SettingsGroup({ children }: { children: React.ReactNode }) {
  const theme = useTheme();
  return (
    <View
      style={{
        backgroundColor: theme.colors.surface,
        borderRadius: theme.radius.md,
        paddingHorizontal: theme.spacing.md,
        borderWidth: 1,
        borderColor: theme.colors.border,
      }}
    >
      {children}
    </View>
  );
}

export function ProfileSettingsScreen() {
  const theme = useTheme();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { auth, logout, refreshProfile } = useAuth();
  const { openFeedback } = useReviewFeedback();
  const { data: profile, isLoading: profileLoading, isFetched } = useProfile();
  const { householdId } = useDefaultHouseholdId();
  const { accounts } = useAccountOptions({ householdId });
  const { billing } = useBillingStatus();
  const { promptUpgrade, startUpgrade } = usePremiumUpgrade();

  const [confirmLogout, setConfirmLogout] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [forecastPickerOpen, setForecastPickerOpen] = useState(false);
  const [simulatedPlanPickerOpen, setSimulatedPlanPickerOpen] = useState(false);
  const [profileEditorOpen, setProfileEditorOpen] = useState(false);
  const [emailOpen, setEmailOpen] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [displayNameDraft, setDisplayNameDraft] = useState("");
  const [utilizationAccount, setUtilizationAccount] = useState<Account | null>(null);
  const [customUtilization, setCustomUtilization] = useState("");
  const [customUtilizationOpen, setCustomUtilizationOpen] = useState(false);
  const [exportingData, setExportingData] = useState(false);
  const [exportingCsv, setExportingCsv] = useState(false);

  const forecastDays = clampForecastDaysForPlan(
    profile?.default_forecast_days ??
      auth.profile?.default_forecast_days ??
      DEFAULT_OPERATIONAL_FORECAST_DAYS,
    billing
  );

  const displayName =
    auth.user?.displayName ??
    (profile?.display_name?.trim() || profile?.username) ??
    auth.user?.username ??
    "—";
  const username = auth.user?.username ?? profile?.username;
  const email = profile?.email ?? auth.profile?.email;
  const emailVerified = profile?.email_verified ?? auth.profile?.email_verified;
  const emailRow = emailSettingsRow({ email, verified: emailVerified });

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
    mutationFn: (days: OperationalForecastDays) => {
      if (!isForecastDaysAllowed(days, billing)) {
        return Promise.reject(new Error(lockedForecastUpsellMessage(days)));
      }
      return updateProfile({ default_forecast_days: days });
    },
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

  const alertsMutation = useMutation({
    mutationFn: (patch: Parameters<typeof updateProfile>[0]) => updateProfile(patch),
    onSuccess: async (updated) => {
      applyUpdatedProfileCache(queryClient, updated);
      await refreshProfile();
    },
    onError: (err) => {
      Alert.alert("Couldn’t update alerts", describeApiError(err));
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

  const testPlanMutation = useMutation({
    mutationFn: (choice: SimulatedPlanChoice) =>
      setTestPlanOverride(choiceToTestPlanOverride(choice)),
    onSuccess: () => {
      invalidateAfterTestPlanChange(queryClient);
      setSimulatedPlanPickerOpen(false);
    },
    onError: (err) => {
      setSimulatedPlanPickerOpen(false);
      Alert.alert("Couldn’t update simulated plan", describeApiError(err));
    },
  });

  async function handleExportData() {
    setExportingData(true);
    try {
      const file = await exportProfileData();
      await shareAuthenticatedFile(file);
    } catch (err) {
      Alert.alert("Couldn’t export data", describeApiError(err));
    } finally {
      setExportingData(false);
    }
  }

  async function handleExportTransactions() {
    setExportingCsv(true);
    try {
      const file = await exportTransactionsCsv();
      await shareAuthenticatedFile(file);
    } catch (err) {
      Alert.alert("Couldn’t export transactions", describeApiError(err));
    } finally {
      setExportingCsv(false);
    }
  }

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
            <Text
              style={{
                color: theme.colors.textSecondary,
                ...theme.typography.caption,
                marginTop: 4,
              }}
            >
              {profileEmailDisplay(email)}
            </Text>
          </Card>

          <SectionHeader title="Account" />
          <SettingsGroup>
            <SettingsRow
              title="Profile details"
              onPress={() => setProfileEditorOpen(true)}
              accessibilityLabel="Profile details"
            />
            <SettingsRow
              title={emailRow.title}
              value={emailRow.value}
              subtitle={emailRow.subtitle}
              onPress={() => setEmailOpen(true)}
              accessibilityLabel={
                emailRow.subtitle
                  ? `Email, ${emailRow.subtitle}, ${emailRow.value}`
                  : `Email, ${emailRow.value}`
              }
            />
            <SettingsRow
              title="Password"
              value="Change password"
              onPress={() => setPasswordOpen(true)}
              accessibilityLabel="Password, Change password"
            />
          </SettingsGroup>

          <SectionHeader title="Plan" />
          <SettingsGroup>
            <SettingsRow
              title="Subscription"
              value={billing?.is_premium ? "Premium" : "Free"}
              onPress={billing?.is_premium ? undefined : () => void startUpgrade()}
              accessibilityLabel={
                billing?.is_premium ? "Premium plan" : "Free plan, upgrade to Premium"
              }
            />
          </SettingsGroup>

          {canShowPlanTestControls(billing, typeof __DEV__ !== "undefined" && __DEV__) ? (
            <>
              <SectionHeader title="Developer Testing" />
              <SettingsGroup>
                <SettingsRow
                  title="Simulated plan"
                  value={simulatedPlanChoiceLabel(simulatedPlanChoice(billing))}
                  subtitle={`Effective plan: ${
                    effectivePlanLabel(billing) === "PREMIUM" ? "Premium" : "Free"
                  }`}
                  onPress={() => setSimulatedPlanPickerOpen(true)}
                  accessibilityLabel={`Simulated plan, ${simulatedPlanChoiceLabel(
                    simulatedPlanChoice(billing)
                  )}`}
                  disabled={testPlanMutation.isPending}
                />
              </SettingsGroup>
            </>
          ) : null}

          <SectionHeader title="Forecast & planning" />
          <SettingsGroup>
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
          </SettingsGroup>
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

          <SectionHeader title="Alerts" />
          <SettingsGroup>
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between",
                minHeight: theme.touchTarget,
                borderBottomWidth: 1 / 2,
                borderBottomColor: theme.colors.border,
              }}
            >
              <Text style={{ color: theme.colors.text, ...theme.typography.body, flex: 1, paddingRight: 12 }}>
                Projected low balance alerts
              </Text>
              <Switch
                value={profile?.projected_funds_alerts_enabled !== false}
                onValueChange={(value) =>
                  alertsMutation.mutate({ projected_funds_alerts_enabled: value })
                }
                accessibilityLabel="Projected low balance alerts"
              />
            </View>
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between",
                minHeight: theme.touchTarget,
                borderBottomWidth: 1 / 2,
                borderBottomColor: theme.colors.border,
              }}
            >
              <Text style={{ color: theme.colors.text, ...theme.typography.body, flex: 1, paddingRight: 12 }}>
                Push notifications
              </Text>
              <Switch
                value={profile?.projected_funds_push_enabled !== false}
                onValueChange={(value) =>
                  alertsMutation.mutate({ projected_funds_push_enabled: value })
                }
                accessibilityLabel="Push notifications"
              />
            </View>
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between",
                minHeight: theme.touchTarget,
              }}
            >
              <Text style={{ color: theme.colors.text, ...theme.typography.body, flex: 1, paddingRight: 12 }}>
                3 days / 1 day / day of
              </Text>
              <Switch
                value={
                  profile?.notify_3_days_before !== false &&
                  profile?.notify_1_day_before !== false &&
                  profile?.notify_day_of !== false
                }
                onValueChange={(value) =>
                  alertsMutation.mutate({
                    notify_3_days_before: value,
                    notify_1_day_before: value,
                    notify_day_of: value,
                  })
                }
                accessibilityLabel="Warning lead times"
              />
            </View>
          </SettingsGroup>

          <SectionHeader title="Data & privacy" />
          <SettingsGroup>
            <SettingsRow
              title="Export my data"
              onPress={() => void handleExportData()}
              disabled={exportingData}
              accessibilityLabel="Export my data"
            />
            <SettingsRow
              title="Export transactions"
              onPress={() => void handleExportTransactions()}
              disabled={exportingCsv}
              accessibilityLabel="Export transactions"
            />
            <SettingsRow
              title="Delete account"
              destructive
              onPress={() => setDeleteOpen(true)}
              accessibilityLabel="Delete account"
            />
          </SettingsGroup>

          <SectionHeader title="Help" />
          <SettingsGroup>
            <SettingsRow
              title="Send feedback"
              onPress={() => openFeedback()}
              accessibilityLabel="Send feedback"
            />
          </SettingsGroup>

          <SectionHeader title="About" />
          <SettingsGroup>
            <View style={{ alignItems: "center", paddingVertical: theme.spacing.md }}>
              <BrandLogo size="small" />
            </View>
            <SettingsRow title="App" value={APP_NAME} />
            <SettingsRow title="Version" value={getAppVersionLabel()} />
            <SettingsRow
              title="Website"
              value={APP_WEB_HOST}
              onPress={() => void Linking.openURL(APP_WEB_URL)}
              accessibilityLabel={`Website, ${APP_WEB_HOST}`}
            />
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
          </SettingsGroup>

          {__DEV__ ? (
            <>
              <SectionHeader title="Development" />
              <SettingsGroup>
                <SettingsRow
                  title="Environment"
                  value={developmentEnvironmentLabel({
                    appEnv: getAppEnvironment(),
                    apiTarget: getApiTargetDisplayLabel(),
                  })}
                />
                <SettingsRow
                  title="Replay getting started"
                  subtitle="Clears local onboarding education flags for this user"
                  onPress={() => {
                    const userId = auth.user?.id;
                    if (userId == null) {
                      Alert.alert("Not signed in", "Log in first, then try again.");
                      return;
                    }
                    void resetGettingStartedEducation(userId)
                      .then(() => {
                        queryClient.invalidateQueries({ queryKey: ONBOARDING_STATUS_QUERY_KEY });
                        Alert.alert(
                          "Getting started reset",
                          "Open Home to see the education sheets again. Welcome only appears when this account does not already have a forecast."
                        );
                      })
                      .catch(() => {
                        Alert.alert("Could not reset", "Try again, or reload the app.");
                      });
                  }}
                />
              </SettingsGroup>
            </>
          ) : null}

          <View style={{ marginTop: theme.spacing.xl, marginBottom: theme.spacing.lg }}>
            <Button label="Log out" variant="danger" onPress={() => setConfirmLogout(true)} />
          </View>
        </>
      )}

      <OptionsPickerSheet
        visible={simulatedPlanPickerOpen}
        title="Simulated plan"
        selectedId={simulatedPlanChoice(billing)}
        options={(["real", "FREE", "PREMIUM"] as const).map((id) => ({
          id,
          title: simulatedPlanChoiceLabel(id),
        }))}
        onClose={() => setSimulatedPlanPickerOpen(false)}
        onSelect={(id) => {
          testPlanMutation.mutate(id as SimulatedPlanChoice);
        }}
      />

      <OptionsPickerSheet
        visible={forecastPickerOpen}
        title="Default forecast window"
        selectedId={String(forecastDays)}
        options={forecastWindowPickerOptions(billing).map((opt) => ({
          id: String(opt.value),
          title: opt.label,
          locked: opt.locked,
          badge: opt.locked ? "Premium" : undefined,
        }))}
        onClose={() => setForecastPickerOpen(false)}
        onSelectLocked={(id) => {
          promptUpgrade("Premium forecast", lockedForecastUpsellMessage(Number(id)));
        }}
        onSelect={(id) => {
          const days = normalizeOperationalForecastDays(Number(id));
          if (!isForecastDaysAllowed(days, billing)) {
            promptUpgrade("Premium forecast", lockedForecastUpsellMessage(days));
            return;
          }
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

      <EmailSettingsSheet
        visible={emailOpen}
        profile={profile ?? auth.profile ?? undefined}
        onClose={() => setEmailOpen(false)}
        onProfileRefreshed={refreshProfile}
      />

      <PasswordSettingsSheet visible={passwordOpen} onClose={() => setPasswordOpen(false)} />

      <DeleteAccountSheet
        visible={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        onDeleted={async () => {
          await logout();
          router.replace("/(auth)/login");
        }}
      />

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
