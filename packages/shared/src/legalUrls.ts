import { APP_WEB_URL } from "./branding";

export const PRIVACY_POLICY_PATH = "/privacy";
export const TERMS_OF_SERVICE_PATH = "/terms";

/** Canonical public legal pages. Clients may override via env for staging. */
export const DEFAULT_PRIVACY_POLICY_URL = `${APP_WEB_URL}${PRIVACY_POLICY_PATH}`;
export const DEFAULT_TERMS_OF_SERVICE_URL = `${APP_WEB_URL}${TERMS_OF_SERVICE_PATH}`;

export function resolveLegalUrl(
  configured: string | null | undefined,
  fallback: string
): string {
  const trimmed = (configured ?? "").trim();
  return trimmed || fallback;
}
