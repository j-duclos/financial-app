import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ApiError } from "@budget-app/api-client";
import {
  EMAIL_VERIFY_BEFORE_UPGRADE_MESSAGE,
  EMAIL_VERIFY_BEFORE_UPGRADE_TITLE,
  RESEND_VERIFICATION_EMAIL_LABEL,
  isEmailVerificationRequiredError,
} from "@/lib/billing";

const dir = dirname(fileURLToPath(import.meta.url));
const hookSource = readFileSync(join(dir, "usePremiumUpgrade.ts"), "utf8");

describe("premium upgrade email verification", () => {
  it("detects unverified checkout without starting Stripe", () => {
    expect(
      isEmailVerificationRequiredError(
        new ApiError(403, "Verify your email before subscribing.", {
          code: "email_verification_required",
        })
      )
    ).toBe(true);
    expect(isEmailVerificationRequiredError(new ApiError(402, "Payment required", {}))).toBe(false);
  });

  it("does not surface HTML 500 bodies in the Upgrade alert", () => {
    expect(hookSource).toMatch(/error\.status >= 500/);
    expect(hookSource).toMatch(/BILLING_UNAVAILABLE_MESSAGE/);
    expect(hookSource).toMatch(/<!doctype html/);
    expect(hookSource).toMatch(/logBillingCheckoutErrorIfDev\(err\)/);
    expect(hookSource).toMatch(/Alert\.alert\("Upgrade", upgradeErrorMessage\(err\)\)/);
  });

  it("aborts Stripe checkout and portal when the billing provider forbids them", () => {
    expect(hookSource).toMatch(/const stripeAllowed = canUseStripeBilling\(\)/);
    expect(hookSource).toMatch(/if \(!stripeAllowed\)/);
    expect(hookSource).toMatch(/logBillingProviderDecision\(\)/);
    expect(hookSource).toMatch(/logCheckoutBlockedLocally/);
    expect(hookSource).toMatch(/PREMIUM_MANAGEMENT_UNAVAILABLE_MESSAGE/);
    expect(hookSource.indexOf("if (!stripeAllowed)")).toBeLessThan(
      hookSource.indexOf("createCheckoutSession()")
    );
    expect(hookSource.indexOf("if (!stripeAllowed)")).toBeLessThan(
      hookSource.indexOf("createPortalSession()")
    );
    expect(hookSource).toMatch(/checkout\.stripeAllowed/);
  });

  it("offers resend verification instead of OK-only", () => {
    expect(hookSource).toMatch(/createCheckoutSession/);
    expect(hookSource).toMatch(/createPortalSession/);
    expect(hookSource).toMatch(/resendVerification/);
    expect(hookSource).toMatch(/EMAIL_VERIFY_BEFORE_UPGRADE_TITLE/);
    expect(hookSource).toMatch(/RESEND_VERIFICATION_EMAIL_LABEL/);
    expect(hookSource).toMatch(/Not now|PREMIUM_NOT_NOW_LABEL/);
    expect(hookSource).toMatch(/isEmailVerificationRequiredError\(err\)[\s\S]*?return;/);
    expect(hookSource).toMatch(/onPress: \(\) => void resendVerificationEmail\(\)/);
    expect(EMAIL_VERIFY_BEFORE_UPGRADE_TITLE).toBe("Verify your email");
    expect(EMAIL_VERIFY_BEFORE_UPGRADE_MESSAGE).toMatch(/FlowSight Premium/);
    expect(RESEND_VERIFICATION_EMAIL_LABEL).toBe("Resend verification email");
  });
});
