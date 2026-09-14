import { Platform } from "react-native";
import { shouldEnableBillingCheckoutDiagnostics } from "@budget-app/api-client";
import {
  canOfferPremiumPurchase,
  canOpenStripePortal,
  canStartStripeCheckout,
  getAvailableBillingProvider as resolveBillingProvider,
  type BillingAppEnvironment,
  type BillingClientPlatform,
  type BillingClientRuntime,
  type BillingProvider,
} from "@budget-app/shared";
import { getApiHostname, getAppEnvironment } from "@/constants/env";

export type {
  BillingAppEnvironment,
  BillingClientPlatform,
  BillingClientRuntime,
  BillingProvider,
};

export function getMobileBillingRuntime(): BillingClientRuntime {
  const os = Platform.OS;
  const platform: BillingClientPlatform =
    os === "ios" ? "ios" : os === "android" ? "android" : "web";
  return {
    platform,
    appEnvironment: getAppEnvironment() as BillingAppEnvironment,
  };
}

export function getAvailableBillingProvider(
  runtime: BillingClientRuntime = getMobileBillingRuntime()
): BillingProvider {
  return resolveBillingProvider(runtime);
}

export function canUseStripeBilling(
  runtime: BillingClientRuntime = getMobileBillingRuntime()
): boolean {
  const provider = getAvailableBillingProvider(runtime);
  return canStartStripeCheckout(provider) && canOpenStripePortal(provider);
}

export function canOfferStripePremiumPurchase(
  runtime: BillingClientRuntime = getMobileBillingRuntime()
): boolean {
  return canOfferPremiumPurchase(getAvailableBillingProvider(runtime));
}

function shouldLogBillingProvider(env = getAppEnvironment()): boolean {
  const isDev = typeof __DEV__ !== "undefined" && __DEV__;
  return shouldEnableBillingCheckoutDiagnostics({ isDev, appEnv: env });
}

export function describeStripeCheckoutBlockReason(
  runtime: BillingClientRuntime = getMobileBillingRuntime()
): string | null {
  const provider = getAvailableBillingProvider(runtime);
  if (canStartStripeCheckout(provider)) return null;
  if (runtime.platform === "ios" && runtime.appEnvironment === "production") {
    return "ios_production_requires_apple_iap";
  }
  return "stripe_checkout_not_allowed_for_provider";
}

export function logBillingProviderDecision(
  runtime: BillingClientRuntime = getMobileBillingRuntime()
): void {
  if (!shouldLogBillingProvider(runtime.appEnvironment)) return;
  const provider = getAvailableBillingProvider(runtime);
  const stripeAllowed = canStartStripeCheckout(provider);
  const portalAllowed = canOpenStripePortal(provider);
  // eslint-disable-next-line no-console
  console.log(
    [
      "[billing-provider]",
      `platform=${runtime.platform}`,
      `app_env=${runtime.appEnvironment}`,
      `provider=${provider}`,
      `stripe_allowed=${stripeAllowed}`,
      `portal_allowed=${portalAllowed}`,
      `api_host=${getApiHostname()}`,
    ].join("\n")
  );
}

export function logCheckoutBlockedLocally(reason: string): void {
  if (!shouldLogBillingProvider()) return;
  // eslint-disable-next-line no-console
  console.log(
    ["[billing-provider]", "checkout_blocked_locally=true", `reason=${reason}`].join("\n")
  );
}
