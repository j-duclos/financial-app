/**
 * Pure helpers for auth session restoration decisions (unit-tested without RN).
 */

export type StoredTokens = {
  access: string | null;
  refresh: string | null;
};

export function hasCompleteSession(tokens: StoredTokens): boolean {
  return Boolean(tokens.access && tokens.refresh);
}

export type SessionRestoreResult =
  | { status: "unauthenticated" }
  | { status: "authenticated"; access: string; refresh: string };

/**
 * Decide how launch should treat stored tokens after SecureStore read.
 * Network profile validation happens in the background; invalid sessions are
 * cleared via the API client's unauthorized callback when refresh fails.
 */
export function resolveSessionRestore(tokens: StoredTokens): SessionRestoreResult {
  if (!hasCompleteSession(tokens)) {
    return { status: "unauthenticated" };
  }
  return {
    status: "authenticated",
    access: tokens.access as string,
    refresh: tokens.refresh as string,
  };
}
