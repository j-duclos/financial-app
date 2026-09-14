import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  canOfferPremiumPurchase,
  canStartStripeCheckout,
  getAvailableBillingProvider,
} from "@budget-app/shared";
import { appleIapClient, AppleIapNotImplementedError } from "./appleIapClient";
import { PREMIUM_MANAGEMENT_UNAVAILABLE_MESSAGE } from "./premiumUpgradeCopy";

const billingProviderSource = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "billingProvider.ts"),
  "utf8"
);

describe("mobile billing provider", () => {
  it("forbids Stripe checkout on iOS production", () => {
    const runtime = { platform: "ios" as const, appEnvironment: "production" as const };
    expect(getAvailableBillingProvider(runtime)).toBe("apple_iap");
    expect(canStartStripeCheckout(getAvailableBillingProvider(runtime))).toBe(false);
    expect(canOfferPremiumPurchase(getAvailableBillingProvider(runtime))).toBe(false);
    expect(billingProviderSource).toMatch(/getAvailableBillingProvider/);
    expect(billingProviderSource).toMatch(/canUseStripeBilling/);
    expect(billingProviderSource).toMatch(/canOfferStripePremiumPurchase/);
    expect(billingProviderSource).toMatch(/Platform\.OS/);
  });

  it("allows Stripe test checkout on iOS preview and development", () => {
    expect(
      canOfferPremiumPurchase(
        getAvailableBillingProvider({ platform: "ios", appEnvironment: "staging" })
      )
    ).toBe(true);
    expect(
      canOfferPremiumPurchase(
        getAvailableBillingProvider({ platform: "ios", appEnvironment: "development" })
      )
    ).toBe(true);
  });

  it("keeps Android Stripe checkout in production", () => {
    expect(
      canOfferPremiumPurchase(
        getAvailableBillingProvider({ platform: "android", appEnvironment: "production" })
      )
    ).toBe(true);
  });

  it("does not fake Apple purchases", async () => {
    await expect(appleIapClient.purchasePremium({ productId: "x" })).rejects.toBeInstanceOf(
      AppleIapNotImplementedError
    );
    await expect(appleIapClient.restorePurchases()).rejects.toBeInstanceOf(
      AppleIapNotImplementedError
    );
    await expect(appleIapClient.getPurchaseStatus()).resolves.toMatchObject({
      isActive: false,
      originalTransactionId: null,
    });
  });

  it("isolates App Store unavailable copy", () => {
    expect(PREMIUM_MANAGEMENT_UNAVAILABLE_MESSAGE).toBe(
      "Premium subscription management is not available in this version."
    );
  });
});
