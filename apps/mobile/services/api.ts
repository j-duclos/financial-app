import {
  configureApiClient,
  configurePerfLogging,
} from "@budget-app/api-client";
import { getApiBaseUrl, getApiTargetLabel } from "@/constants/env";
import { saveAccessToken } from "@/services/secureTokenStorage";
import { getStartupCorrelationId, recordTimelineBackendMeta } from "@/lib/startupTrace";

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
    onResponseMeta: (meta) => {
      if (!meta.path.includes("/api/timeline/")) return;
      const serverMs = meta.timelineElapsedMs ? Number(meta.timelineElapsedMs) : null;
      recordTimelineBackendMeta({
        cache: meta.timelineCache ?? null,
        serverDurationMs: serverMs != null && Number.isFinite(serverMs) ? serverMs : meta.elapsedMs,
        requestId: meta.requestId ?? getStartupCorrelationId(),
      });
    },
  });
  if (!wired && __DEV__) {
    configurePerfLogging(true, getApiTargetLabel());
    wired = true;
  }
}
