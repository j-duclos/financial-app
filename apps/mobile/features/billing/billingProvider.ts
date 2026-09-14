import { Platform } from "react-native";
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
import { getAppEnvironment } from "@/constants/env";

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
