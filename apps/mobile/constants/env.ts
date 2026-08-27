/**
 * Mobile API and environment configuration.
 *
 * Environments (EXPO_PUBLIC_APP_ENV):
 * - development — local Metro; HTTP allowed for localhost/LAN
 * - staging — internal beta builds; HTTPS required
 * - production — store builds; HTTPS required; no localhost
 *
 * Set EXPO_PUBLIC_API_URL in `.env` or EAS build profile env.
 */
import Constants from "expo-constants";
import * as Device from "expo-device";
import { Platform } from "react-native";

export type AppEnvironment = "development" | "staging" | "production";

const DEFAULT_API_PORT = 8000;

type ExpoExtra = {
  appEnv?: string;
  apiUrl?: string;
};

function extra(): ExpoExtra {
  return (Constants.expoConfig?.extra ?? {}) as ExpoExtra;
}

export function getAppEnvironment(): AppEnvironment {
  const raw = (process.env.EXPO_PUBLIC_APP_ENV ?? extra().appEnv ?? "development").trim();
  if (raw === "staging" || raw === "production") return raw;
  return "development";
}

function stripTrailingSlash(url: string): string {
  return url.replace(/\/$/, "");
}

function isLocalhostHost(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname.startsWith("10.0.2.") ||
    /^192\.168\./.test(hostname) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(hostname)
  );
}

function isPrivateOrLocalUrl(url: string): boolean {
  try {
    const normalized = url.startsWith("http") ? url : `http://${url}`;
    const { hostname, protocol } = new URL(normalized);
    if (protocol !== "https:" && protocol !== "http:") return true;
    return isLocalhostHost(hostname);
  } catch {
    return true;
  }
}

function isHttpsUrl(url: string): boolean {
  try {
    return new URL(url.startsWith("http") ? url : `https://${url}`).protocol === "https:";
  } catch {
    return false;
  }
}

/** Host Metro/Expo uses to reach the dev machine (e.g. 192.168.1.52 from Expo Go QR). */
function getExpoDevMachineHost(): string | null {
  const raw =
    (Constants.expoGoConfig as { debuggerHost?: string } | undefined)?.debuggerHost ??
    Constants.expoConfig?.hostUri ??
    null;
  if (!raw) return null;
  const host = raw.split(":")[0]?.trim();
  if (!host || isLocalhostHost(host)) return null;
  return host;
}

function defaultDevBaseUrl(): string {
  if (Platform.OS === "android" && !Device.isDevice) {
    return `http://10.0.2.2:${DEFAULT_API_PORT}`;
  }
  const lanHost = getExpoDevMachineHost();
  if (lanHost) {
    return `http://${lanHost}:${DEFAULT_API_PORT}`;
  }
  return `http://localhost:${DEFAULT_API_PORT}`;
}

function resolveConfiguredUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return defaultDevBaseUrl();

  const base = stripTrailingSlash(trimmed);

  if (__DEV__ && isPrivateOrLocalUrl(base) && Device.isDevice) {
    const lanHost = getExpoDevMachineHost();
    if (lanHost && isLocalhostHost(new URL(base.startsWith("http") ? base : `http://${base}`).hostname)) {
      return `http://${lanHost}:${DEFAULT_API_PORT}`;
    }
  }

  return base;
}

function assertProductionApiUrl(url: string, env: AppEnvironment): void {
  if (env === "development") return;

  if (isPrivateOrLocalUrl(url)) {
    throw new Error(
      `${env} builds cannot use a local or private-network API URL (${url}). Set EXPO_PUBLIC_API_URL to your HTTPS API host.`
    );
  }
  if (!isHttpsUrl(url)) {
    throw new Error(
      `${env} builds require HTTPS for EXPO_PUBLIC_API_URL. Plain HTTP is not permitted for authenticated financial APIs.`
    );
  }
}

let cachedApiBaseUrl: string | null = null;

export function getApiBaseUrl(): string {
  if (cachedApiBaseUrl) return cachedApiBaseUrl;

  const env = getAppEnvironment();
  const fromEnv = (process.env.EXPO_PUBLIC_API_URL || extra().apiUrl || "").trim();

  let resolved: string;
  if (fromEnv) {
    resolved = resolveConfiguredUrl(fromEnv);
  } else if (env === "development" || __DEV__) {
    resolved = defaultDevBaseUrl();
  } else {
    throw new Error(
      "EXPO_PUBLIC_API_URL is not configured. Set it to your production API origin (HTTPS, no trailing slash)."
    );
  }

  assertProductionApiUrl(resolved, env);
  cachedApiBaseUrl = resolved;
  return resolved;
}

/** Reset cached URL (tests only). */
export function resetApiBaseUrlCacheForTests(): void {
  cachedApiBaseUrl = null;
}

/** Dev-only hint for login/settings when diagnosing connectivity. */
export function getApiConnectivityHint(): string {
  const url = getApiBaseUrl();
  if (!__DEV__) return url;
  return `${url}\nEnv: ${getAppEnvironment()}\nStart API: cd backend && python manage.py runserver 0.0.0.0:8000`;
}

export const API_REQUEST_TIMEOUT_MS = 90_000;
