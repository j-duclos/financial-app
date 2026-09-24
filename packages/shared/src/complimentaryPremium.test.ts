import { describe, expect, it } from "vitest";
import type { BillingStatus } from "./types";
import {
  COMPLIMENTARY_PREMIUM_LABEL,
  canManageStripeSubscription,
  complimentaryPremiumUntilCopy,
  hasComplimentaryPremium,
  stripeStatusGrantsPremium,
} from "./complimentaryPremium";

const complimentary: BillingStatus = {
  plan: "PREMIUM",
  is_premium: true,
  status: "inactive",
  cancel_at_period_end: false,
  current_period_end: null,
  has_stripe_customer: false,
  complimentary_premium: true,
  complimentary_premium_until: "2026-12-01T00:00:00+00:00",
};

describe("complimentary Premium display helpers", () => {
  it("treats complimentary_premium as the only grant flag", () => {
    expect(hasComplimentaryPremium(complimentary)).toBe(true);
    expect(hasComplimentaryPremium({ ...complimentary, complimentary_premium: false })).toBe(false);
    expect(hasComplimentaryPremium({ ...complimentary, complimentary_premium: undefined })).toBe(
      false
    );
  });

  it("does not treat Premium as a Stripe subscription to manage", () => {
    expect(canManageStripeSubscription(complimentary)).toBe(false);
    expect(
      canManageStripeSubscription({ ...complimentary, has_stripe_customer: true })
    ).toBe(false);
    expect(
      canManageStripeSubscription({
        ...complimentary,
        status: "active",
        has_stripe_customer: true,
      })
    ).toBe(true);
  });

  it("formats the expiration date and ignores inactive Stripe status as paid", () => {
    expect(COMPLIMENTARY_PREMIUM_LABEL).toBe("Complimentary Premium");
    expect(complimentaryPremiumUntilCopy(complimentary)).toBe("Active through December 1, 2026");
    expect(stripeStatusGrantsPremium("inactive")).toBe(false);
    expect(stripeStatusGrantsPremium("active")).toBe(true);
  });
});
