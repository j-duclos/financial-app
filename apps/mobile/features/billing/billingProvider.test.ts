import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";

vi.mock("react-native", () => ({
  Platform: { OS: "ios" },
}));

vi.mock("expo-constants", () => ({
  default: {
    expoConfig: {
      extra: {
        appEnv: "development",
        apiUrl: "https://financial-app-1-tu0l.onrender.com",
      },
    },
  },
}));
import {
  canOfferPremiumPurchase,
  canOpenStripePortal,
  canStartStripeCheckout,
  getAvailableBillingProvider,
} from "@budget-app/shared";
import { appleIapClient, AppleIapNotImplementedError } from "./appleIapClient";
import { PREMIUM_MANAGEMENT_UNAVAILABLE_MESSAGE } from "./premiumUpgradeCopy";
import { describeStripeCheckoutBlockReason } from "./billingProvider";

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
    expect(
      describeStripeCheckoutBlockReason({ platform: "ios", appEnvironment: "development" })
    ).toBeNull();
    expect(
      describeStripeCheckoutBlockReason({ platform: "ios", appEnvironment: "staging" })
    ).toBeNull();
  });

  it("blocks Stripe locally on iOS production before HTTP", () => {
    const runtime = { platform: "ios" as const, appEnvironment: "production" as const };
    const provider = getAvailableBillingProvider(runtime);
    expect(provider).toBe("apple_iap");
    expect(canStartStripeCheckout(provider)).toBe(false);
    expect(canOpenStripePortal(provider)).toBe(false);
    expect(describeStripeCheckoutBlockReason(runtime)).toBe("ios_production_requires_apple_iap");
  });

  it("keeps billing-provider selection deterministic for ios env variants", () => {
    expect(getAvailableBillingProvider({ platform: "ios", appEnvironment: "development" })).toBe(
      "stripe_ios_preview"
    );
    expect(getAvailableBillingProvider({ platform: "ios", appEnvironment: "staging" })).toBe(
      "stripe_ios_preview"
    );
    expect(getAvailableBillingProvider({ platform: "ios", appEnvironment: "production" })).toBe(
      "apple_iap"
    );
  });

  it("logs billing-provider decisions without emails or tokens", async () => {
    vi.resetModules();
    vi.doMock("@/constants/env", () => ({
      getAppEnvironment: () => "development",
      getApiHostname: () => "financial-app-1-tu0l.onrender.com",
    }));
    vi.stubGlobal("__DEV__", true);
    const { logBillingProviderDecision, logCheckoutBlockedLocally } = await import(
      "./billingProvider"
    );
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    logBillingProviderDecision({ platform: "ios", appEnvironment: "development" });
    logCheckoutBlockedLocally("ios_production_requires_apple_iap");
    const output = log.mock.calls.map((call) => call.join(" ")).join("\n");
    expect(output).toContain("[billing-provider]");
    expect(output).toContain("platform=ios");
    expect(output).toContain("app_env=development");
    expect(output).toContain("provider=stripe_ios_preview");
    expect(output).toContain("stripe_allowed=true");
    expect(output).toContain("portal_allowed=true");
    expect(output).toContain("api_host=financial-app-1-tu0l.onrender.com");
    expect(output).toContain("checkout_blocked_locally=true");
    expect(output).toContain("reason=ios_production_requires_apple_iap");
    expect(output).not.toMatch(/@|Bearer |token=/i);
    log.mockRestore();
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
