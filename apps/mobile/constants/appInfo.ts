import Constants from "expo-constants";
import type { AppEnvironment } from "./env";

type ExpoExtra = {
  appEnv?: AppEnvironment;
  privacyPolicyUrl?: string;
  termsUrl?: string;
  supportEmail?: string;
  sentryDsn?: string;
};

function extra(): ExpoExtra {
  return (Constants.expoConfig?.extra ?? {}) as ExpoExtra;
}

/** Human-readable version for Settings → About (e.g. `0.9.0 (1)`). */
export function getAppVersionLabel(): string {
  const version = Constants.expoConfig?.version ?? "0.0.0";
  const build =
    Constants.nativeBuildVersion ??
    (Constants.expoConfig?.ios?.buildNumber as string | undefined) ??
    String(Constants.expoConfig?.android?.versionCode ?? "");
  return build ? `${version} (${build})` : version;
}

export function getPrivacyPolicyUrl(): string | null {
  const url = extra().privacyPolicyUrl?.trim();
  return url || null;
}

export function getTermsUrl(): string | null {
  const url = extra().termsUrl?.trim();
  return url || null;
}

export function getSupportEmail(): string | null {
  const email = extra().supportEmail?.trim();
  return email || null;
}

export function getSentryDsn(): string | null {
  const dsn = extra().sentryDsn?.trim();
  return dsn || null;
}
