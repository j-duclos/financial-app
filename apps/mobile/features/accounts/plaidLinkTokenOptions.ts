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
