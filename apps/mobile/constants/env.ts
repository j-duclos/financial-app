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
 * - development — Metro / Xcode Debug; HTTP allowed for localhost / LAN / emulator hosts
 * - staging — EAS preview / internal beta; HTTPS required; no localhost
 * - production — store builds; HTTPS required; no localhost
 *
 * Physical iPhone Xcode Debug (`npx expo run:ios --device` / Xcode Run):
 * EXPO_PUBLIC_* are inlined by Metro from apps/mobile/.env (and extra.apiUrl /
 * extra.appEnv from app.config.ts evaluated in that Metro process).
 * eas.json is NOT applied. ios/.xcode.env only exports NODE_BINARY.
 * See apps/mobile/IOS_DEVICE.md.
 */
import { parseFinancialEngineMode, type FinancialEngineMode } from "@budget-app/shared/financial-engine";
import {
  PRODUCTION_RENDER_HOST,
  PRODUCTION_RENDER_ORIGIN,
  isStaleRenderHost,
} from "@budget-app/shared";
import Constants from "expo-constants";

export type AppEnvironment = "development" | "staging" | "production";

/** Coarse target for logs/UI: local Django vs Render (or other hosted) API. */
export type ApiTargetLabel = "local" | "render" | "other";

/** Classification of the hostname the physical device will actually call. */
export type ResolvedApiHostKind =
  | "expected_render"
  | "localhost"
  | "loopback"
  | "lan"
  | "stale_render"
  | "flowsight360"
  | "empty"
  | "other";

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
  if (isStaleRenderHost(parseUrl(url).hostname)) {
    throw new Error(
      `${env} builds cannot use retired Render host ${parseUrl(url).hostname}. ` +
        `Set EXPO_PUBLIC_API_URL to ${PRODUCTION_RENDER_ORIGIN}.`
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
        `Example: http://192.168.1.10:8000 or ${PRODUCTION_RENDER_ORIGIN}`
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

export function classifyResolvedApiHost(hostname: string): ResolvedApiHostKind {
  const host = hostname.trim().toLowerCase();
  if (!host || host === "unknown") return "empty";
  if (host === "localhost") return "localhost";
  if (host === "127.0.0.1" || host === "::1") return "loopback";
  if (isStaleRenderHost(host)) return "stale_render";
  if (host === PRODUCTION_RENDER_HOST) return "expected_render";
  if (host === "flowsight360.com" || host.endsWith(".flowsight360.com")) return "flowsight360";
  if (
    host.startsWith("10.0.2.") ||
    /^192\.168\./.test(host) ||
    /^10\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host)
  ) {
    return "lan";
  }
  return "other";
}

export function getApiTargetLabel(): ApiTargetLabel {
  const host = getApiHostname().toLowerCase();
  if (isLocalhostHost(host)) return "local";
  if (host.endsWith(".onrender.com") || host.includes("onrender.com")) return "render";
  if (host === "flowsight360.com" || host.endsWith(".flowsight360.com")) return "render";
  return "other";
}

export type ApiRuntimeDiagnostic = {
  environment: AppEnvironment;
  resolved_api_host: string;
  build_profile: string;
};

export function resolveBuildProfile(env: AppEnvironment = getAppEnvironment()): string {
  const fromEas = (
    process.env.EAS_BUILD_PROFILE ||
    process.env.EXPO_PUBLIC_EAS_BUILD_PROFILE ||
    ""
  ).trim();
  if (fromEas) return fromEas;
  if (env === "production") return "production";
  if (env === "staging") return "preview";
  return "development";
}

export function getApiRuntimeDiagnostic(): ApiRuntimeDiagnostic {
  return {
    environment: getAppEnvironment(),
    resolved_api_host: getApiHostname(),
    build_profile: resolveBuildProfile(),
  };
}

export function formatApiRuntimeDiagnostic(diagnostic: ApiRuntimeDiagnostic): string {
  return [
    "[api-runtime]",
    `environment=${diagnostic.environment}`,
    `resolved_api_host=${diagnostic.resolved_api_host}`,
    `build_profile=${diagnostic.build_profile}`,
  ].join("\n");
}

export function shouldLogApiRuntimeDiagnostic(
  isDev: boolean,
  env: AppEnvironment = getAppEnvironment()
): boolean {
  return isDev || env === "staging";
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
  const isDev = typeof __DEV__ !== "undefined" && __DEV__;
  const env = getAppEnvironment();
  if (!shouldLogApiRuntimeDiagnostic(isDev, env)) return;
  try {
    const diagnostic = getApiRuntimeDiagnostic();
    if (isDev) {
      const label = getApiTargetLabel();
      // eslint-disable-next-line no-console
      console.log(`[MOBILE ENV] API: ${label} (${diagnostic.resolved_api_host})`);
    }
    // eslint-disable-next-line no-console
    console.log(formatApiRuntimeDiagnostic(diagnostic));
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

/**
 * Client financial-engine display mode. Off (`server`) unless explicitly set.
 * Not a secret. `shadow` compares locally; `client` renders the local walk
 * with server fallback.
 */
export function getFinancialEngineMode(): FinancialEngineMode {
  return parseFinancialEngineMode(
    process.env.EXPO_PUBLIC_FINANCIAL_ENGINE_MODE,
    process.env.EXPO_PUBLIC_FINANCIAL_ENGINE_SHADOW
  );
}

/** True when the local engine runs (shadow or client). */
export function isFinancialEngineShadowEnabled(): boolean {
  return getFinancialEngineMode() !== "server";
}
