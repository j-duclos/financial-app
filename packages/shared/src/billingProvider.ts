/**
 * Client billing-provider strategy.
 *
 * Server entitlements stay authoritative (Stripe status or an allowed test
 * override). This helper only decides which purchase/management UI a client
 * may show. It never grants or revokes Premium.
 */

export type BillingProvider =
  | "stripe_web"
  | "stripe_android"
  | "stripe_ios_preview"
  | "apple_iap";

export type BillingClientPlatform = "web" | "ios" | "android";

export type BillingAppEnvironment = "development" | "staging" | "production";

export type BillingClientRuntime = {
  platform: BillingClientPlatform;
  appEnvironment: BillingAppEnvironment;
};

/**
 * Resolve the billing provider for the current client runtime.
 *
 * - web: Stripe Checkout
 * - Android: existing Stripe Checkout (Play digital-goods IAP is not used)
 * - iOS App Store production: Apple IAP (not implemented — no Stripe CTA)
 * - iOS development / EAS preview: existing Stripe test flow
 */
export function getAvailableBillingProvider(runtime: BillingClientRuntime): BillingProvider {
  if (runtime.platform === "web") return "stripe_web";
  if (runtime.platform === "android") return "stripe_android";
  if (runtime.appEnvironment === "production") return "apple_iap";
  return "stripe_ios_preview";
}

export function canStartStripeCheckout(provider: BillingProvider): boolean {
  return (
    provider === "stripe_web" ||
    provider === "stripe_android" ||
    provider === "stripe_ios_preview"
  );
}

export function canOpenStripePortal(provider: BillingProvider): boolean {
  return canStartStripeCheckout(provider);
}

export function canOfferPremiumPurchase(provider: BillingProvider): boolean {
  return canStartStripeCheckout(provider);
}

export function isAppleIapProvider(provider: BillingProvider): boolean {
  return provider === "apple_iap";
}
