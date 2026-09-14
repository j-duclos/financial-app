import { describe, expect, it } from "vitest";
import {
  canOfferPremiumPurchase,
  canOpenStripePortal,
  canStartStripeCheckout,
  getAvailableBillingProvider,
  isAppleIapProvider,
} from "./billingProvider";

describe("getAvailableBillingProvider", () => {
  it("uses Stripe on web in every environment", () => {
    for (const appEnvironment of ["development", "staging", "production"] as const) {
      expect(getAvailableBillingProvider({ platform: "web", appEnvironment })).toBe("stripe_web");
    }
  });

  it("uses Stripe on Android in every environment", () => {
    for (const appEnvironment of ["development", "staging", "production"] as const) {
      expect(getAvailableBillingProvider({ platform: "android", appEnvironment })).toBe(
        "stripe_android"
      );
    }
  });

  it("keeps Stripe test checkout on iOS development and preview", () => {
    expect(
      getAvailableBillingProvider({ platform: "ios", appEnvironment: "development" })
    ).toBe("stripe_ios_preview");
    expect(getAvailableBillingProvider({ platform: "ios", appEnvironment: "staging" })).toBe(
      "stripe_ios_preview"
    );
  });

  it("selects Apple IAP on iOS App Store production and forbids Stripe CTAs", () => {
    const provider = getAvailableBillingProvider({
      platform: "ios",
      appEnvironment: "production",
    });
    expect(provider).toBe("apple_iap");
    expect(isAppleIapProvider(provider)).toBe(true);
    expect(canStartStripeCheckout(provider)).toBe(false);
    expect(canOpenStripePortal(provider)).toBe(false);
    expect(canOfferPremiumPurchase(provider)).toBe(false);
  });

  it("allows Stripe checkout and portal on Android production", () => {
    const provider = getAvailableBillingProvider({
      platform: "android",
      appEnvironment: "production",
    });
    expect(canStartStripeCheckout(provider)).toBe(true);
    expect(canOpenStripePortal(provider)).toBe(true);
    expect(canOfferPremiumPurchase(provider)).toBe(true);
  });
});
