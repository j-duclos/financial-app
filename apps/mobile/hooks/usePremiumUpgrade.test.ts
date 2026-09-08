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

  it("offers resend verification instead of OK-only", () => {
    expect(hookSource).toMatch(/resendVerification/);
    expect(hookSource).toMatch(/EMAIL_VERIFY_BEFORE_UPGRADE_TITLE/);
    expect(hookSource).toMatch(/RESEND_VERIFICATION_EMAIL_LABEL/);
    expect(hookSource).toMatch(/Not now/);
    expect(hookSource).toMatch(/isEmailVerificationRequiredError\(err\)[\s\S]*?return;/);
    expect(hookSource).toMatch(/onPress: \(\) => void resendVerificationEmail\(\)/);
    expect(EMAIL_VERIFY_BEFORE_UPGRADE_TITLE).toBe("Verify your email");
    expect(EMAIL_VERIFY_BEFORE_UPGRADE_MESSAGE).toMatch(/FlowSight Premium/);
    expect(RESEND_VERIFICATION_EMAIL_LABEL).toBe("Resend verification email");
  });
});
