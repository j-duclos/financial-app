import { getAndroidPackageName, getPlaidRedirectUri } from "@/constants/env";

export type PlaidLinkTokenCreateOptions = {
  android_package_name?: string;
  redirect_uri?: string;
};

/**
 * Plaid Android rejects redirect_uri when android_package_name is set.
 * iOS OAuth (Capital One, Chase, …) requires an explicit HTTPS redirect_uri.
 */
export function plaidLinkTokenCreateOptions(
  platform: string
): PlaidLinkTokenCreateOptions | undefined {
  if (platform === "android") {
    return { android_package_name: getAndroidPackageName() };
  }
  if (platform === "ios") {
    return { redirect_uri: getPlaidRedirectUri() };
  }
  return undefined;
}

/** Apex and www must both be tried — Plaid allowlists are exact-match. */
export function plaidRedirectUriHostVariants(uri: string): string[] {
  const primary = uri.trim().replace(/\/$/, "");
  if (!primary) return [];
  try {
    const parsed = new URL(primary);
    const host = parsed.hostname.toLowerCase();
    if (!host || host === "localhost" || host === "127.0.0.1") return [primary];
    parsed.hostname = host.startsWith("www.") ? host.slice(4) : `www.${host}`;
    const alternate = parsed.toString().replace(/\/$/, "");
    if (alternate === primary) return [primary];
    return [primary, alternate];
  } catch {
    return [primary];
  }
}

/**
 * iOS: configured HTTPS URI, then www/apex twin, then omit so production
 * PLAID_REDIRECT_URI can win. Never mix android_package_name with redirect_uri.
 */
export function plaidLinkTokenCreateAttempts(
  platform: string
): Array<PlaidLinkTokenCreateOptions | undefined> {
  if (platform === "android") {
    return [{ android_package_name: getAndroidPackageName() }];
  }
  if (platform === "ios") {
    return [
      ...plaidRedirectUriHostVariants(getPlaidRedirectUri()).map((redirect_uri) => ({
        redirect_uri,
      })),
      undefined,
    ];
  }
  return [undefined];
}

export function isPlaidRedirectUriRejected(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return msg.includes("redirect_uri") && (msg.includes("rejected") || msg.includes("allowlist") || msg.includes("dashboard"));
}
