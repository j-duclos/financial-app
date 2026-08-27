import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const dir = dirname(fileURLToPath(import.meta.url));
const screenSource = readFileSync(join(dir, "ProfileSettingsScreen.tsx"), "utf8");
const routeSource = readFileSync(join(dir, "../../app/(app)/profile.tsx"), "utf8");
const clearCacheSource = readFileSync(join(dir, "../../lib/clearUserQueryCache.ts"), "utf8");
const authSource = readFileSync(join(dir, "../auth/AuthContext.tsx"), "utf8");

describe("Profile & Settings screen", () => {
  it("route uses ProfileSettingsScreen instead of inline placeholder content", () => {
    expect(routeSource).toMatch(/ProfileSettingsScreen/);
    expect(routeSource).not.toMatch(/Change it on web Settings/);
  });

  it("allows editing default forecast window via updateProfile", () => {
    expect(screenSource).toMatch(/Default forecast window/);
    expect(screenSource).toMatch(/updateProfile/);
    expect(screenSource).toMatch(/default_forecast_days/);
    expect(screenSource).toMatch(/invalidateAfterForecastWindowChange/);
    expect(screenSource).not.toMatch(/Change it on web Settings/);
    expect(screenSource).not.toMatch(/mobile editing lands/);
  });

  it("edits credit utilization via account target_utilization_percent", () => {
    expect(screenSource).toMatch(/Credit utilization target/);
    expect(screenSource).toMatch(/updateAccount/);
    expect(screenSource).toMatch(/target_utilization_percent/);
    expect(screenSource).not.toMatch(/hard-?code.*10%/i);
  });

  it("never renders EXPO_PUBLIC environment variable names", () => {
    expect(screenSource).not.toMatch(/EXPO_PUBLIC_/);
    expect(screenSource).not.toMatch(/EXPO_PUBLIC_PRIVACY_URL/);
    expect(screenSource).not.toMatch(/EXPO_PUBLIC_TERMS_URL/);
    expect(screenSource).not.toMatch(/EXPO_PUBLIC_SUPPORT_EMAIL/);
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

  it("omits unimplemented biometric and notification settings", () => {
    expect(screenSource).not.toMatch(/Biometric/);
    expect(screenSource).not.toMatch(/Push notification/i);
    expect(screenSource).not.toMatch(/expo-local-authentication/);
  });

  it("logout clears auth tokens and user query cache", () => {
    expect(screenSource).toMatch(/logout\(\)/);
    expect(authSource).toMatch(/clearUserQueryCache/);
    expect(authSource).toMatch(/clearTokens/);
    expect(clearCacheSource).toMatch(/PROFILE_QUERY_KEY/);
    expect(clearCacheSource).toMatch(/FINANCIAL_QUERY_PREFIXES/);
  });

  it("uses compact settings rows rather than one card per preference", () => {
    expect(screenSource).toMatch(/SettingsRow/);
    expect(screenSource).toMatch(/Forecast & planning/);
    expect(screenSource).toMatch(/SectionHeader/);
  });
});
