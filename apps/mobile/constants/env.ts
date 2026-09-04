/**
 * Mobile API and environment configuration (single source of truth).
 *
 * Canonical variable: EXPO_PUBLIC_API_URL
 * App mode: EXPO_PUBLIC_APP_ENV = development | staging | production
 *
 * Switch Local ↔ Render by changing EXPO_PUBLIC_API_URL only (then reload Metro).
 * Do not hard-code hosts in feature files — use getApiBaseUrl().
 *
 * Environments:
 * - development — Metro; HTTP allowed for localhost / LAN / emulator hosts
 * - staging — EAS preview / internal beta; HTTPS required; no localhost
 * - production — store builds; HTTPS required; no localhost
 */
import Constants from "expo-constants";

export type AppEnvironment = "development" | "staging" | "production";

/** Coarse target for logs/UI: local Django vs Render (or other hosted) API. */
export type ApiTargetLabel = "local" | "render" | "other";

type ExpoExtra = {
  appEnv?: string;
  apiUrl?: string;
};

function extra(): ExpoExtra {
  const fromExpoConfig = (Constants.expoConfig?.extra ?? {}) as ExpoExtra;
  const fromManifest = (
    Constants as { manifest?: { extra?: ExpoExtra } }
  ).manifest?.extra;
  return { ...fromManifest, ...fromExpoConfig };
}

function getMetroHostname(): string {
  const hostUri =
    Constants.expoConfig?.hostUri ||
    (Constants as { debuggerHost?: string }).debuggerHost ||
    "";
  return String(hostUri).split(":")[0]?.trim() ?? "";
}

/**
 * Last-resort origin when Metro was started before `.env` existed.
 * Android emulator loopback is the host machine, reached at 10.0.2.2 — not 127.0.0.1.
 */
function getDevFallbackApiUrl(): string | null {
  if (typeof __DEV__ === "undefined" || !__DEV__) return null;
  const hostname = getMetroHostname();
  if (
    !hostname ||
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname.startsWith("10.0.2.")
  ) {
    return "http://10.0.2.2:8000";
  }
  return `http://${hostname}:8000`;
}

export function getAppEnvironment(): AppEnvironment {
  const raw = (process.env.EXPO_PUBLIC_APP_ENV ?? extra().appEnv ?? "development").trim();
  if (raw === "staging" || raw === "production") return raw;
  return "development";
}

function stripTrailingSlash(url: string): string {
  return url.replace(/\/$/, "");
}

function parseUrl(url: string): URL {
  const normalized = url.startsWith("http") ? url : `http://${url}`;
  return new URL(normalized);
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
    const { hostname, protocol } = parseUrl(url);
    if (protocol !== "https:" && protocol !== "http:") return true;
    return isLocalhostHost(hostname);
  } catch {
    return true;
  }
}

function isHttpsUrl(url: string): boolean {
  try {
    return parseUrl(url).protocol === "https:";
  } catch {
    return false;
  }
}

function assertProductionApiUrl(url: string, env: AppEnvironment): void {
  if (env === "development") return;

  if (isPrivateOrLocalUrl(url)) {
    throw new Error(
      `${env} builds cannot use a local or private-network API URL (${url}). ` +
        `Set EXPO_PUBLIC_API_URL to your HTTPS Render/API host.`
    );
  }
  if (!isHttpsUrl(url)) {
    throw new Error(
      `${env} builds require HTTPS for EXPO_PUBLIC_API_URL. ` +
        `Plain HTTP is not permitted for authenticated financial APIs.`
    );
  }
}

let cachedApiBaseUrl: string | null = null;

/**
 * Resolve the single mobile API origin (canonical API_BASE_URL).
 * Requires EXPO_PUBLIC_API_URL (or app.config extra.apiUrl) in every environment —
 * no silent localhost fallback. In __DEV__ only, if those are empty, derive
 * the API origin from Expo's hostUri (Android emulator → http://10.0.2.2:8000).
 */
export function getApiBaseUrl(): string {
  if (cachedApiBaseUrl) return cachedApiBaseUrl;

  const env = getAppEnvironment();
  const fromEnv = [
    process.env.EXPO_PUBLIC_API_URL,
    extra().apiUrl,
  ]
    .map((value) => (value ?? "").trim())
    .find((value) => value.length > 0 && value !== "undefined") ?? "";
  const fromDevHost = fromEnv ? "" : getDevFallbackApiUrl() ?? "";
  const chosen = fromEnv || fromDevHost;

  if (!chosen) {
    throw new Error(
      "EXPO_PUBLIC_API_URL is not configured. " +
        "Copy apps/mobile/.env.local.example or .env.render.example to .env, " +
        "set the API origin (no trailing slash), and restart Expo."
    );
  }

  if (fromDevHost && __DEV__) {
    // eslint-disable-next-line no-console
    console.warn(
      `[MOBILE ENV] EXPO_PUBLIC_API_URL missing in this Metro process; using ${fromDevHost}. ` +
        `Stop every Expo/Metro instance, then: npx expo start --clear`
    );
  }

  const resolved = stripTrailingSlash(chosen);
  try {
    parseUrl(resolved);
  } catch {
    throw new Error(
      `EXPO_PUBLIC_API_URL is not a valid URL: ${fromEnv}. ` +
        `Example: http://192.168.1.10:8000 or https://financial-app-1-tu0l.onrender.com`
    );
  }

  assertProductionApiUrl(resolved, env);
  cachedApiBaseUrl = resolved;
  return resolved;
}

/** Hostname only — never log credentials or query strings. */
export function getApiHostname(): string {
  try {
    return parseUrl(getApiBaseUrl()).hostname;
  } catch {
    return "unknown";
  }
}

export function getApiTargetLabel(): ApiTargetLabel {
  const host = getApiHostname().toLowerCase();
  if (isLocalhostHost(host)) return "local";
  if (host.endsWith(".onrender.com") || host.includes("onrender.com")) return "render";
  return "other";
}

/** Human label for Profile / debug UI (dev only). */
export function getApiTargetDisplayLabel(): string {
  const label = getApiTargetLabel();
  if (label === "local") return "Local";
  if (label === "render") return "Render";
  return "Other";
}

/**
 * Development-only startup line, e.g. `[MOBILE ENV] API: local (192.168.1.10)`.
 * No-op outside __DEV__. Never prints tokens or full URLs with credentials.
 */
export function logMobileApiEnvironment(): void {
  if (!__DEV__) return;
  try {
    const label = getApiTargetLabel();
    const host = getApiHostname();
    // eslint-disable-next-line no-console
    console.log(`[MOBILE ENV] API: ${label} (${host})`);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(
      `[MOBILE ENV] API configuration error: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

/** Reset cached URL (tests only). */
export function resetApiBaseUrlCacheForTests(): void {
  cachedApiBaseUrl = null;
}

/** Dev-only hint for login/settings when diagnosing connectivity. */
export function getApiConnectivityHint(): string {
  try {
    const url = getApiBaseUrl();
    if (!__DEV__) return url;
    return (
      `${url}\n` +
      `Env: ${getAppEnvironment()} · Target: ${getApiTargetDisplayLabel()}\n` +
      `Local API: cd backend && ALLOWED_HOSTS='*' python3 manage.py runserver 0.0.0.0:8000`
    );
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

export const API_REQUEST_TIMEOUT_MS = 90_000;
