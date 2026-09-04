import type { ConfigContext, ExpoConfig } from "expo/config";

/** Bump for beta releases; EAS production profile may auto-increment native build numbers. */
const APP_VERSION = "0.9.0";

export default ({ config }: ConfigContext): ExpoConfig => {
  const appEnv = (process.env.EXPO_PUBLIC_APP_ENV ?? "development").trim() || "development";
  const displayName =
    appEnv === "production" ? "Budget" : appEnv === "staging" ? "Budget (Staging)" : "Budget (Dev)";

  return {
    ...config,
    name: displayName,
    slug: "budget-app",
    version: APP_VERSION,
    orientation: "portrait",
    icon: "./assets/images/icon.png",
    scheme: "budgetapp",
    userInterfaceStyle: "automatic",
    newArchEnabled: true,
    splash: {
      image: "./assets/images/splash-icon.png",
      resizeMode: "contain",
      backgroundColor: "#F4F6F8",
    },
    ios: {
      supportsTablet: true,
      bundleIdentifier: "com.budgetapp.mobile",
      buildNumber: process.env.IOS_BUILD_NUMBER ?? "1",
      infoPlist: {
        NSFaceIDUsageDescription:
          "Unlock Budget with Face ID to protect your financial information on this device.",
      },
    },
    android: {
      adaptiveIcon: {
        foregroundImage: "./assets/images/adaptive-icon.png",
        backgroundColor: "#F4F6F8",
      },
      edgeToEdgeEnabled: true,
      package: "com.budgetapp.mobile",
      versionCode: Number(process.env.ANDROID_VERSION_CODE ?? "1"),
    },
    web: {
      bundler: "metro",
      output: "static",
      favicon: "./assets/images/favicon.png",
    },
    plugins: ["expo-router", "expo-secure-store"],
    experiments: {
      typedRoutes: true,
    },
    extra: {
      appEnv,
      apiUrl:
        process.env.EXPO_PUBLIC_API_URL ||
        (appEnv === "development" ? "http://10.0.2.2:8000" : ""),
      privacyPolicyUrl: process.env.EXPO_PUBLIC_PRIVACY_URL ?? "",
      termsUrl: process.env.EXPO_PUBLIC_TERMS_URL ?? "",
      supportEmail: process.env.EXPO_PUBLIC_SUPPORT_EMAIL ?? "",
      sentryDsn: process.env.EXPO_PUBLIC_SENTRY_DSN ?? "",
      eas: {
        projectId: process.env.EAS_PROJECT_ID ?? "",
      },
    },
  };
};
