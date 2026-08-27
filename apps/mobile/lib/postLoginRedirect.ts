/**
 * Safe post-login redirect for deep links. Only in-app paths are allowed.
 */
const ALLOWED_PREFIXES = [
  "/(app)",
  "/transaction/",
  "/account/",
  "/accounts",
  "/recurring/",
  "/automation/",
  "/budget/",
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

export function sanitizePostLoginRedirect(raw: string | undefined | null): string | null {
  if (!raw || typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed.startsWith("/")) return null;
  if (trimmed.includes("..") || trimmed.includes("\\")) return null;
  if (!ALLOWED_PREFIXES.some((prefix) => trimmed.startsWith(prefix))) return null;
  return trimmed;
}

let pendingRedirect: string | null = null;

export function setPendingPostLoginRedirect(path: string): void {
  pendingRedirect = sanitizePostLoginRedirect(path);
}

export function consumePendingPostLoginRedirect(): string | null {
  const next = pendingRedirect;
  pendingRedirect = null;
  return next;
}
