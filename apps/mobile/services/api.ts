import {
  configureApiClient,
  configureAuthRecoveryDiagnostics,
  configureBillingCheckoutDiagnostics,
  configurePerfLogging,
  shouldEnableAuthRecoveryDiagnostics,
  shouldEnableBillingCheckoutDiagnostics,
} from "@budget-app/api-client";
import { getApiBaseUrl, getApiTargetLabel, getAppEnvironment } from "@/constants/env";
import { saveAccessToken } from "@/services/secureTokenStorage";
import {
  getStartupCorrelationId,
  recordStartupRequest,
  recordStartupRequestStart,
  recordTimelineBackendMeta,
} from "@/lib/startupTrace";

export { ApiError, describeApiError, describeAuthFormError } from "./apiErrors";

type TokenRefs = {
  getAccess: () => string | null;
  getRefresh: () => string | null;
  onAccessUpdated: (access: string) => void;
  onUnauthorized?: () => void;
};

let wired = false;

/**
 * Configure the shared @budget-app/api-client once for the mobile runtime.
 * All mobile features (auth, dashboard, accounts, …) share this single base URL.
 * Call again when token refs change (refs are closures over current auth state).
 */
export function wireApiClient(refs: TokenRefs): void {
  configureApiClient({
    baseUrl: getApiBaseUrl(),
    getAccessToken: refs.getAccess,
    getRefreshToken: refs.getRefresh,
    setAccessToken: (access: string) => {
      void saveAccessToken(access);
      refs.onAccessUpdated(access);
    },
    onUnauthorized: refs.onUnauthorized,
    extraHeaders: () => {
      const requestId = getStartupCorrelationId();
      return requestId ? { "X-FlowSight-Request-Id": requestId } : {};
    },
    onRequestStart: ({ path, method }) => {
      recordStartupRequestStart(path, method);
    },
    onResponseMeta: (meta) => {
      const timelineServer = meta.timelineElapsedMs ? Number(meta.timelineElapsedMs) : null;
      const dashboardServer = meta.dashboardElapsedMs ? Number(meta.dashboardElapsedMs) : null;
      const serverMs =
        timelineServer != null && Number.isFinite(timelineServer)
          ? timelineServer
          : dashboardServer != null && Number.isFinite(dashboardServer)
            ? dashboardServer
            : null;
      if (meta.path.includes("/api/timeline/")) {
        recordTimelineBackendMeta({
          cache: meta.timelineCache ?? null,
          serverDurationMs: serverMs ?? meta.elapsedMs,
          requestId: meta.requestId ?? getStartupCorrelationId(),
        });
      }
      recordStartupRequest({
        path: meta.path,
        method: meta.method,
        durationMs: meta.elapsedMs,
        status: meta.status,
        cache: meta.timelineCache ?? null,
        serverMs,
      });
    },
  });
  const isDev = typeof __DEV__ !== "undefined" && __DEV__;
  const appEnv = getAppEnvironment();
  if (shouldEnableBillingCheckoutDiagnostics({ isDev, appEnv })) {
    configureBillingCheckoutDiagnostics(true);
  }
  if (shouldEnableAuthRecoveryDiagnostics({ isDev, appEnv })) {
    configureAuthRecoveryDiagnostics(true);
  }
  if (!wired && isDev) {
    configurePerfLogging(true, getApiTargetLabel());
    wired = true;
  }
}
