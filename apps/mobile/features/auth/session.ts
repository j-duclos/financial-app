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
  | { status: "authenticated"; access: string; refresh: string }
  | { status: "expired" };

/**
 * Decide how launch should treat stored tokens after a profile probe.
 * Profile success ⇒ authenticated; profile failure with tokens ⇒ expired/clear.
 */
export function resolveSessionRestore(
  tokens: StoredTokens,
  profileOk: boolean
): SessionRestoreResult {
  if (!hasCompleteSession(tokens)) {
    return { status: "unauthenticated" };
  }
  if (!profileOk) {
    return { status: "expired" };
  }
  return {
    status: "authenticated",
    access: tokens.access as string,
    refresh: tokens.refresh as string,
  };
}
