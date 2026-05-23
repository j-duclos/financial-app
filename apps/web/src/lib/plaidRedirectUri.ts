/**
 * Plaid OAuth redirect_uri sent when creating a link token.
 * Must exactly match an entry in Plaid Dashboard → Developers → API → Allowed redirect URIs.
 */
export function getPlaidRedirectUri(): string | undefined {
  if (typeof window === "undefined") return undefined;

  const fromEnv = import.meta.env.VITE_PLAID_REDIRECT_URI;
  if (fromEnv != null && String(fromEnv).trim() !== "") {
    return String(fromEnv).trim().replace(/\/$/, "");
  }

  return `${window.location.origin}/plaid/oauth-return`;
}
