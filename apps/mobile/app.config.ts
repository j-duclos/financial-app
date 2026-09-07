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

export default ({ config }: ConfigContext): ExpoConfig => {
  const appEnv = (process.env.EXPO_PUBLIC_APP_ENV ?? "development").trim() || "development";
  const apiUrl = (process.env.EXPO_PUBLIC_API_URL ?? "").trim();

  return {
    ...config,
    name: IOS_DISPLAY_NAME,
    slug: "budget-app",
    version: APP_VERSION,
    orientation: "portrait",
    icon: "./assets/branding/flowsight-logo.jpg",
    scheme: "budgetapp",
    userInterfaceStyle: "automatic",
    newArchEnabled: true,
    splash: {
      image: "./assets/branding/flowsight-logo.jpg",
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
          icon: "./assets/branding/flowsight-logo.jpg",
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
      privacyPolicyUrl: process.env.EXPO_PUBLIC_PRIVACY_URL ?? "",
      termsUrl: process.env.EXPO_PUBLIC_TERMS_URL ?? "",
      supportEmail: process.env.EXPO_PUBLIC_SUPPORT_EMAIL ?? "",
      sentryDsn: process.env.EXPO_PUBLIC_SENTRY_DSN ?? "",
      iosAppStoreId: process.env.EXPO_PUBLIC_IOS_APP_STORE_ID ?? "",
      googlePlayStoreUrl: process.env.EXPO_PUBLIC_GOOGLE_PLAY_STORE_URL ?? "",
      androidPackageName: ANDROID_PACKAGE_NAME,
      eas: {
        projectId: process.env.EAS_PROJECT_ID ?? "",
      },
    },
  };
};
