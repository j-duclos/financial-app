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
 * no silent localhost fallback and no device-based auto-selection.
 */
export function getApiBaseUrl(): string {
  if (cachedApiBaseUrl) return cachedApiBaseUrl;

  const env = getAppEnvironment();
  const fromEnv = (process.env.EXPO_PUBLIC_API_URL || extra().apiUrl || "").trim();

  if (!fromEnv) {
    throw new Error(
      "EXPO_PUBLIC_API_URL is not configured. " +
        "Copy apps/mobile/.env.local.example or .env.render.example to .env, " +
        "set the API origin (no trailing slash), and restart Expo."
    );
  }

  const resolved = stripTrailingSlash(fromEnv);
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
  const url = getApiBaseUrl();
  if (!__DEV__) return url;
  return (
    `${url}\n` +
    `Env: ${getAppEnvironment()} · Target: ${getApiTargetDisplayLabel()}\n` +
    `Local API: cd backend && ALLOWED_HOSTS='*' python3 manage.py runserver 0.0.0.0:8000`
  );
}

export const API_REQUEST_TIMEOUT_MS = 90_000;
