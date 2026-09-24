export const PREMIUM_INVITE_STORAGE_KEY = "flowsight.premiumInviteToken";

export function persistPremiumInviteToken(token: string): void {
  const value = token.trim();
  if (!value) return;
  try {
    sessionStorage.setItem(PREMIUM_INVITE_STORAGE_KEY, value);
  } catch {
    /* ignore quota / private mode */
  }
}

export function readPremiumInviteToken(): string | null {
  try {
    const value = sessionStorage.getItem(PREMIUM_INVITE_STORAGE_KEY);
    return value?.trim() || null;
  } catch {
    return null;
  }
}

export function clearPremiumInviteToken(): void {
  try {
    sessionStorage.removeItem(PREMIUM_INVITE_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

export function inviteRegisterPath(token: string, email?: string): string {
  const params = new URLSearchParams({ invite: token });
  if (email) params.set("email", email);
  return `/register?${params.toString()}`;
}

export function inviteLoginPath(token: string): string {
  return `/login?${new URLSearchParams({ invite: token }).toString()}`;
}
