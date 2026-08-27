import {
  configureApiClient,
  configurePerfLogging,
} from "@budget-app/api-client";
import { getApiBaseUrl } from "@/constants/env";
import { saveAccessToken } from "@/services/secureTokenStorage";

export { ApiError, describeApiError } from "./apiErrors";

type TokenRefs = {
  getAccess: () => string | null;
  getRefresh: () => string | null;
  onAccessUpdated: (access: string) => void;
  onUnauthorized?: () => void;
};

let wired = false;

/**
 * Configure the shared @budget-app/api-client once for the mobile runtime.
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
  });
  if (!wired && __DEV__) {
    configurePerfLogging(true);
    wired = true;
  }
}
