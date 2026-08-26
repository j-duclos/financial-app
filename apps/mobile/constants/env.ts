/**
 * Mobile API environment configuration.
 *
 * Expo public env is inlined at bundle time. Use `.env` / `.env.local` in apps/mobile:
 *   EXPO_PUBLIC_API_URL=http://localhost:8000
 *
 * Device notes:
 * - iOS Simulator: localhost usually works
 * - Android Emulator: use http://10.0.2.2:8000
 * - Physical device (Expo Go): localhost points at the phone — we auto-use your Mac's LAN IP
 * - Production: https://your-api-host (no trailing slash)
 */
import Constants from "expo-constants";
import * as Device from "expo-device";
import { Platform } from "react-native";

const EXTRA_API_URL =
  (Constants.expoConfig?.extra as { apiUrl?: string } | undefined)?.apiUrl ??
  (Constants.manifest2?.extra as { apiUrl?: string } | undefined)?.apiUrl;

const DEFAULT_API_PORT = 8000;

function stripTrailingSlash(url: string): string {
  return url.replace(/\/$/, "");
}

function isLocalhostHost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1";
}

function isLocalhostUrl(url: string): boolean {
  try {
    const normalized = url.startsWith("http") ? url : `http://${url}`;
    const { hostname } = new URL(normalized);
    return isLocalhostHost(hostname);
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

  // Physical device + localhost in .env → rewrite to LAN IP from Expo.
  if (__DEV__ && isLocalhostUrl(base) && Device.isDevice) {
    const lanHost = getExpoDevMachineHost();
    if (lanHost) {
      return `http://${lanHost}:${DEFAULT_API_PORT}`;
    }
  }

  return base;
}

export function getApiBaseUrl(): string {
  const fromEnv = (process.env.EXPO_PUBLIC_API_URL || EXTRA_API_URL || "").trim();
  if (fromEnv) return resolveConfiguredUrl(fromEnv);
  if (__DEV__) return defaultDevBaseUrl();
  throw new Error(
    "EXPO_PUBLIC_API_URL is not configured. Set it to your production API origin (no trailing slash)."
  );
}

/** Dev-only hint for login/settings when diagnosing connectivity. */
export function getApiConnectivityHint(): string {
  const url = getApiBaseUrl();
  if (!__DEV__) return url;
  return `${url}\nStart API: docker compose up backend (from repo root)`;
}

export const API_REQUEST_TIMEOUT_MS = 90_000;
