/**
 * Safe post-login redirect for deep links. Only in-app paths are allowed.
 * Explicit logout must not restore the previous screen (e.g. Profile).
 */
const ALLOWED_PREFIXES = [
  "/(app)",
  "/transaction/",
  "/account/",
  "/accounts",
  "/recurring/",
  "/automation/",
  "/budget",
  "/reports",
  "/what-if",
  "/payment-planner",
  "/goals",
  "/goal/",
  "/action-center",
  "/spending-limits",
  "/profile",
  "/categories",
  "/reconcile",
] as const;

/** Tabs root (Home). `/(app)/(tabs)/index` is not a valid Expo Router href. */
export const POST_LOGIN_HOME_ROUTE = "/(app)/(tabs)";

export function sanitizePostLoginRedirect(raw: string | undefined | null): string | null {
  if (!raw || typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed.startsWith("/")) return null;
  if (trimmed.includes("..") || trimmed.includes("\\")) return null;
  if (!ALLOWED_PREFIXES.some((prefix) => trimmed.startsWith(prefix))) return null;
  return trimmed;
}

let pendingRedirect: string | null = null;
/** Set during logout so AppLayout cannot recapture the current path. */
let ignoreUnauthenticatedPathCapture = false;

export function beginLogoutSession(): void {
  pendingRedirect = null;
  ignoreUnauthenticatedPathCapture = true;
}

export function setPendingPostLoginRedirect(path: string): void {
  if (ignoreUnauthenticatedPathCapture) {
    return;
  }
  pendingRedirect = sanitizePostLoginRedirect(path);
}

export function consumePendingPostLoginRedirect(): string | null {
  const next = pendingRedirect;
  pendingRedirect = null;
  ignoreUnauthenticatedPathCapture = false;
  return next;
}

export function resetPostLoginRedirectForTests(): void {
  pendingRedirect = null;
  ignoreUnauthenticatedPathCapture = false;
}
