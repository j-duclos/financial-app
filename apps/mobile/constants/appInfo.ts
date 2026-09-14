import Constants from "expo-constants";
import {
  APP_NAME,
  APP_WEB_HOST,
  APP_WEB_URL,
  DEFAULT_PRIVACY_POLICY_URL,
  DEFAULT_TERMS_OF_SERVICE_URL,
  resolveLegalUrl,
} from "@budget-app/shared";
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

export function getAppName(): string {
  return APP_NAME;
}

export function getWebAppUrl(): string {
  return APP_WEB_URL;
}

export function getWebAppHost(): string {
  return APP_WEB_HOST;
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

export function getPrivacyPolicyUrl(): string {
  return resolveLegalUrl(extra().privacyPolicyUrl, DEFAULT_PRIVACY_POLICY_URL);
}

export function getTermsUrl(): string {
  return resolveLegalUrl(extra().termsUrl, DEFAULT_TERMS_OF_SERVICE_URL);
}

export function getSupportEmail(): string | null {
  const email = extra().supportEmail?.trim();
  return email || null;
}

export function getSentryDsn(): string | null {
  const dsn = extra().sentryDsn?.trim();
  return dsn || null;
}
