import type { ConfigContext, ExpoConfig } from "expo/config";

/** Bump for beta releases; EAS production profile may auto-increment native build numbers. */
const APP_VERSION = "0.9.0";

/**
 * Home-screen / Xcode display name. Keep in sync with APP_NAME in
 * packages/shared/src/branding.ts (Expo config cannot import that TS module).
 */
export const IOS_DISPLAY_NAME = "FlowSight";

/** iOS App Store / Xcode bundle id. No native ios/ history exists in this repo. */
export const IOS_BUNDLE_IDENTIFIER = "com.jduclos.flowsight";

/** Android application id. Keep as the single source for Play Store URLs. */
export const ANDROID_PACKAGE_NAME = "com.budgetapp.mobile";

/** Public legal pages. Keep in sync with packages/shared/src/legalUrls.ts. */
const DEFAULT_LEGAL_ORIGIN = "https://flowsight360.com";
export const DEFAULT_PRIVACY_POLICY_URL = `${DEFAULT_LEGAL_ORIGIN}/privacy`;
export const DEFAULT_TERMS_OF_SERVICE_URL = `${DEFAULT_LEGAL_ORIGIN}/terms`;

/** Store icon: 1024x1024 PNG, no alpha. Splash stays a separate asset. */
export const IOS_STORE_ICON = "./assets/images/icon.png";
export const APP_SPLASH_IMAGE = "./assets/images/splash-icon.png";

export default ({ config }: ConfigContext): ExpoConfig => {
  const appEnv = (process.env.EXPO_PUBLIC_APP_ENV ?? "development").trim() || "development";
  const apiUrl = (process.env.EXPO_PUBLIC_API_URL ?? "").trim();

  return {
    ...config,
    name: IOS_DISPLAY_NAME,
    slug: "budget-app",
    version: APP_VERSION,
    orientation: "portrait",
    icon: IOS_STORE_ICON,
    scheme: "budgetapp",
    userInterfaceStyle: "automatic",
    newArchEnabled: true,
    splash: {
      image: APP_SPLASH_IMAGE,
      resizeMode: "contain",
      backgroundColor: "#F4F6F8",
    },
    ios: {
      supportsTablet: true,
      bundleIdentifier: IOS_BUNDLE_IDENTIFIER,
      buildNumber: process.env.IOS_BUILD_NUMBER ?? "1",
      infoPlist: {
        CFBundleDisplayName: IOS_DISPLAY_NAME,
        CFBundleName: IOS_DISPLAY_NAME,
        ...(appEnv === "development"
          ? {
              NSAppTransportSecurity: {
                NSAllowsLocalNetworking: true,
              },
              NSLocalNetworkUsageDescription:
                "FlowSight connects to your local development API on the same Wi-Fi network.",
            }
          : {}),
      },
    },
    android: {
      adaptiveIcon: {
        foregroundImage: "./assets/images/adaptive-icon.png",
        backgroundColor: "#F4F6F8",
      },
      edgeToEdgeEnabled: true,
      package: ANDROID_PACKAGE_NAME,
      versionCode: Number(process.env.ANDROID_VERSION_CODE ?? "1"),
    },
    web: {
      bundler: "metro",
      output: "static",
      favicon: "./assets/images/favicon.png",
    },
    plugins: [
      "expo-router",
      "expo-secure-store",
      [
        "expo-notifications",
        {
          icon: IOS_STORE_ICON,
          color: "#1D4ED8",
          defaultChannel: "projected-funds",
        },
      ],
    ],
    experiments: {
      typedRoutes: true,
    },
    extra: {
      appEnv,
      apiUrl,
      privacyPolicyUrl: process.env.EXPO_PUBLIC_PRIVACY_URL?.trim() || DEFAULT_PRIVACY_POLICY_URL,
      termsUrl: process.env.EXPO_PUBLIC_TERMS_URL?.trim() || DEFAULT_TERMS_OF_SERVICE_URL,
      supportEmail: process.env.EXPO_PUBLIC_SUPPORT_EMAIL ?? "",
      sentryDsn: process.env.EXPO_PUBLIC_SENTRY_DSN ?? "",
      iosAppStoreId: process.env.EXPO_PUBLIC_IOS_APP_STORE_ID ?? "",
      googlePlayStoreUrl: process.env.EXPO_PUBLIC_GOOGLE_PLAY_STORE_URL ?? "",
      androidPackageName: ANDROID_PACKAGE_NAME,
      plaidRedirectUri: process.env.EXPO_PUBLIC_PLAID_REDIRECT_URI?.trim() || "https://flowsight360.com/plaid/oauth-return",
      eas: {
        ...(process.env.EAS_PROJECT_ID?.trim()
          ? { projectId: process.env.EAS_PROJECT_ID.trim() }
          : {}),
      },
    },
  };
};
