import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { APP_WEB_HOST, APP_WEB_URL } from "@budget-app/shared";

const dir = dirname(fileURLToPath(import.meta.url));
const screenSource = readFileSync(join(dir, "ProfileSettingsScreen.tsx"), "utf8");
const emailSource = readFileSync(join(dir, "EmailSettingsSheet.tsx"), "utf8");
const passwordSource = readFileSync(join(dir, "PasswordSettingsSheet.tsx"), "utf8");
const deleteSource = readFileSync(join(dir, "DeleteAccountSheet.tsx"), "utf8");
const exportSource = readFileSync(join(dir, "profileExport.ts"), "utf8");
const detailsSource = readFileSync(join(dir, "ProfileSettingsScreen.tsx"), "utf8");
const routeSource = readFileSync(join(dir, "../../app/(app)/profile.tsx"), "utf8");
const clearCacheSource = readFileSync(join(dir, "../../lib/clearUserQueryCache.ts"), "utf8");
const authSource = readFileSync(join(dir, "../auth/AuthContext.tsx"), "utf8");
const webProfileSource = readFileSync(
  join(dir, "../../../web/src/pages/Profile.tsx"),
  "utf8"
);

describe("Profile & Settings screen", () => {
  it("route uses ProfileSettingsScreen instead of inline placeholder content", () => {
    expect(routeSource).toMatch(/ProfileSettingsScreen/);
    expect(routeSource).not.toMatch(/Change it on web Settings/);
  });

  it("keeps username read-only and display name editable in Profile details", () => {
    expect(detailsSource).toMatch(/Username @\{username\} \(read-only\)/);
    expect(detailsSource).toMatch(/label="Display name"/);
    expect(detailsSource).toMatch(/updateProfile\(\{ display_name:/);
    expect(detailsSource).not.toMatch(/updateProfile\(\{[^}]*email/);
  });

  it("adds Account email and password rows outside Profile details", () => {
    expect(screenSource).toMatch(/SectionHeader title="Account"/);
    expect(screenSource).toMatch(/EmailSettingsSheet/);
    expect(screenSource).toMatch(/PasswordSettingsSheet/);
    expect(screenSource).toMatch(/profileEmailDisplay/);
    expect(screenSource).toMatch(/emailSettingsRow/);
    expect(screenSource).toMatch(/value="Change password"/);
    expect(screenSource).toMatch(/projected_funds_alerts_enabled/);
    expect(screenSource).toMatch(/projected_funds_push_enabled/);
  });

  it("change email uses the dedicated endpoint and current password", () => {
    expect(emailSource).toMatch(/changeEmail\(/);
    expect(emailSource).toMatch(/current_password: currentPassword/);
    expect(emailSource).toMatch(/email: newEmail\.trim\(\)/);
    expect(emailSource).toMatch(/Enter your current password/);
    expect(emailSource).toMatch(/EMAIL_CHANGE_SUCCESS/);
    expect(emailSource).toMatch(/onProfileRefreshed/);
    expect(emailSource).toMatch(/shouldShowResendVerification/);
    expect(emailSource).toMatch(/resendVerification/);
    expect(emailSource).not.toMatch(/updateProfile/);
  });

  it("password sheet validates mismatch, uses secure fields, and closes on success", () => {
    expect(passwordSource).toMatch(/label="Current password"/);
    expect(passwordSource).toMatch(/label="New password"/);
    expect(passwordSource).toMatch(/label="Confirm new password"/);
    expect(passwordSource).toMatch(/secureTextEntry/);
    expect(passwordSource).toMatch(/clientPasswordErrors/);
    expect(passwordSource).toMatch(/passwordApiFieldErrors/);
    expect(passwordSource).toMatch(/changePassword\(/);
    expect(passwordSource).toMatch(/onClose\(\)/);
    expect(passwordSource).toMatch(/PASSWORD_CHANGE_SUCCESS/);
    expect(passwordSource).not.toMatch(/forgotPassword/);
    expect(passwordSource).not.toMatch(/invalidateAfterForecastWindowChange/);
  });

  it("wires export share flow without client-side CSV recomputation", () => {
    expect(screenSource).toMatch(/Export my data/);
    expect(screenSource).toMatch(/Export transactions/);
    expect(screenSource).toMatch(/exportProfileData/);
    expect(screenSource).toMatch(/exportTransactionsCsv/);
    expect(screenSource).toMatch(/shareAuthenticatedFile/);
    expect(exportSource).toMatch(/Sharing\.shareAsync/);
    expect(exportSource).not.toMatch(/downloadAuthenticatedFile/);
    expect(screenSource).not.toMatch(/join\(",/);
    expect(exportSource).not.toMatch(/amount \+|running_balance/);
  });

  it("calls delete preflight before confirmation and clears session after success", () => {
    expect(screenSource).toMatch(/Delete account/);
    expect(deleteSource).toMatch(/getDeleteAccountPreflight/);
    expect(deleteSource).toMatch(/enabled: visible/);
    expect(deleteSource).toMatch(/deleteUserAccount/);
    expect(deleteSource).toMatch(/Delete my account/);
    expect(deleteSource).toMatch(/clientDeleteAccountError/);
    expect(deleteSource).toMatch(/Type \$\{DELETE_CONFIRMATION\} to confirm/);
    expect(screenSource).toMatch(/await logout\(\)/);
    expect(screenSource).toMatch(/router\.replace\("\/\(auth\)\/login"\)/);
    expect(authSource).toMatch(/clearUserQueryCache/);
    expect(authSource).toMatch(/clearTokens/);
    expect(clearCacheSource).toMatch(/PROFILE_QUERY_KEY/);
  });

  it("preserves subscription, forecast entitlement, and utilization editing", () => {
    expect(screenSource).toMatch(/Subscription/);
    expect(screenSource).toMatch(/Default forecast window/);
    expect(screenSource).toMatch(/updateProfile/);
    expect(screenSource).toMatch(/default_forecast_days/);
    expect(screenSource).toMatch(/clampForecastDaysForPlan/);
    expect(screenSource).toMatch(/isForecastDaysAllowed/);
    expect(screenSource).toMatch(/forecastWindowPickerOptions/);
    expect(screenSource).toMatch(/invalidateAfterForecastWindowChange/);
    expect(screenSource).toMatch(/Credit utilization target/);
    expect(screenSource).toMatch(/updateAccount/);
    expect(screenSource).toMatch(/target_utilization_percent/);
    expect(screenSource).toMatch(/invalidateAfterUtilizationTargetChange/);
  });

  it("does not change web Profile", () => {
    expect(webProfileSource).toMatch(/export default function Profile/);
    expect(webProfileSource).toMatch(/ChangeEmailSection/);
    expect(webProfileSource).toMatch(/AccountLifecycleSection/);
    expect(webProfileSource).toMatch(/changePassword/);
  });

  it("never renders EXPO_PUBLIC environment variable names", () => {
    expect(screenSource).not.toMatch(/EXPO_PUBLIC_/);
  });

  it("gates development environment info behind __DEV__", () => {
    expect(screenSource).toMatch(/__DEV__/);
    expect(screenSource).toMatch(/Development/);
    expect(screenSource).toMatch(/developmentEnvironmentLabel/);
  });

  it("shows privacy/terms/support only when configured", () => {
    expect(screenSource).toMatch(/getPrivacyPolicyUrl/);
    expect(screenSource).toMatch(/getTermsUrl/);
    expect(screenSource).toMatch(/getSupportEmail/);
    expect(screenSource).toMatch(/hasConfiguredLegalLinks/);
    expect(screenSource).toMatch(/Privacy Policy/);
    expect(screenSource).toMatch(/Terms of Service/);
    expect(screenSource).toMatch(/Support/);
  });

  it("omits unimplemented biometric settings", () => {
    expect(screenSource).not.toMatch(/Biometric/);
    expect(screenSource).not.toMatch(/expo-local-authentication/);
    expect(screenSource).toMatch(/Push notifications/);
  });

  it("logout clears auth tokens and user query cache", () => {
    expect(screenSource).toMatch(/logout\(\)/);
    expect(authSource).toMatch(/clearUserQueryCache/);
    expect(authSource).toMatch(/clearTokens/);
    expect(clearCacheSource).toMatch(/FINANCIAL_QUERY_PREFIXES/);
  });

  it("uses compact settings rows rather than one card per preference", () => {
    expect(screenSource).toMatch(/SettingsRow/);
    expect(screenSource).toMatch(/Forecast & planning/);
    expect(screenSource).toMatch(/Data & privacy/);
    expect(screenSource).toMatch(/SectionHeader/);
  });

  it("shows a Website row in About that opens the FlowSight web app", () => {
    expect(APP_WEB_URL).toBe("https://flowsight.com");
    expect(APP_WEB_HOST).toBe("flowsight.com");
    expect(screenSource).toMatch(/SectionHeader title="Help"/);
    expect(screenSource).toMatch(/title="Send feedback"/);
    expect(screenSource).toMatch(/openFeedback/);
    expect(screenSource).toMatch(/SectionHeader title="About"/);
    expect(screenSource).toMatch(/title="Website"/);
    expect(screenSource).toMatch(/value=\{APP_WEB_HOST\}/);
    expect(screenSource).toMatch(/Linking\.openURL\(APP_WEB_URL\)/);
    expect(screenSource).toMatch(/Website, \$\{APP_WEB_HOST\}/);
    expect(screenSource).toMatch(/title="Version"/);
    expect(screenSource).toMatch(/Privacy Policy/);
    expect(screenSource).toMatch(/Terms of Service/);
    expect(screenSource).toMatch(/Support/);
    const aboutIdx = screenSource.indexOf('SectionHeader title="About"');
    const websiteIdx = screenSource.indexOf('title="Website"');
    const versionIdx = screenSource.indexOf('title="Version"');
    const privacyIdx = screenSource.indexOf("Privacy Policy");
    expect(aboutIdx).toBeGreaterThan(-1);
    expect(websiteIdx).toBeGreaterThan(aboutIdx);
    expect(versionIdx).toBeGreaterThan(aboutIdx);
    expect(privacyIdx).toBeGreaterThan(websiteIdx);
  });
});
