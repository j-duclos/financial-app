import { describe, expect, it } from "vitest";
import type { BillingStatus } from "@budget-app/shared";
import { ApiError } from "@budget-app/api-client";
import {
  ACCESS_UNTIL_PERIOD_END_MESSAGE,
  ALREADY_PREMIUM_MESSAGE,
  BILLING_UNAVAILABLE_MESSAGE,
  EMAIL_VERIFICATION_REQUIRED_MESSAGE,
  PREMIUM_MONTHLY_PRICE_DISPLAY,
} from "./billing";
import {
  billingActionErrorMessage,
  billingStatusLabel,
  isEmailVerificationRequiredError,
  planLabel,
  premiumPeriodCopy,
  subscriptionStatusLabel,
} from "./billingDisplay";

const freeStatus: BillingStatus = {
  plan: "FREE",
  is_premium: false,
  status: "inactive",
  cancel_at_period_end: false,
  current_period_end: null,
  has_stripe_customer: false,
};

describe("billing display helpers", () => {
  it("keeps the retail price in one constant", () => {
    expect(PREMIUM_MONTHLY_PRICE_DISPLAY).toBe("$7.99 / month");
  });

  it("labels Free and Premium plans", () => {
    expect(planLabel("FREE")).toBe("Free");
    expect(planLabel("PREMIUM")).toBe("Premium");
  });

  it("uses friendly subscription status copy", () => {
    expect(subscriptionStatusLabel("past_due")).toBe("Payment issue");
    expect(subscriptionStatusLabel("unpaid")).toBe("Payment required");
    expect(subscriptionStatusLabel("canceled")).toBe("Canceled");
    expect(subscriptionStatusLabel("incomplete")).toBe("Subscription setup incomplete");
    expect(subscriptionStatusLabel("paused")).toBe("Subscription paused");
    expect(subscriptionStatusLabel("active")).toBe("Active");
    expect(subscriptionStatusLabel("trialing")).toBe("Trial");
    expect(billingStatusLabel(freeStatus)).toBe("Free plan");
  });

  it("does not say Renews when cancel_at_period_end is true", () => {
    const copy = premiumPeriodCopy({
      plan: "PREMIUM",
      is_premium: true,
      status: "active",
      cancel_at_period_end: true,
      current_period_end: "2026-10-05T00:00:00Z",
      has_stripe_customer: true,
    });
    expect(copy?.label).toBe("Premium access ends");
    expect(copy?.date).toBe("October 5, 2026");
    expect(copy?.cancelNotice).toBe(ACCESS_UNTIL_PERIOD_END_MESSAGE);
    expect(copy?.label).not.toMatch(/Renew/i);
  });

  it("shows next billing date for an active subscription that is not canceling", () => {
    const copy = premiumPeriodCopy({
      plan: "PREMIUM",
      is_premium: true,
      status: "active",
      cancel_at_period_end: false,
      current_period_end: "2026-10-05T12:00:00Z",
      has_stripe_customer: true,
    });
    expect(copy?.label).toBe("Next billing date");
    expect(copy?.date).toBe("October 5, 2026");
    expect(copy?.cancelNotice).toBeNull();
  });

  it("does not invent premium period copy when is_premium is false", () => {
    expect(
      premiumPeriodCopy({
        ...freeStatus,
        current_period_end: "2026-10-05T00:00:00Z",
        has_stripe_customer: true,
      })
    ).toBeNull();
  });

  it("maps checkout conflicts and missing Stripe config without leaking secrets", () => {
    expect(billingActionErrorMessage(new ApiError(409, "already subscribed"))).toBe(
      ALREADY_PREMIUM_MESSAGE
    );
    expect(
      billingActionErrorMessage(new ApiError(503, "Set STRIPE_SECRET_KEY and STRIPE_PREMIUM_PRICE_ID."))
    ).toBe(BILLING_UNAVAILABLE_MESSAGE);
    const unverified = new ApiError(403, "Verify your email before subscribing.", {
      code: "email_verification_required",
    });
    expect(isEmailVerificationRequiredError(unverified)).toBe(true);
    expect(billingActionErrorMessage(unverified)).toBe(EMAIL_VERIFICATION_REQUIRED_MESSAGE);
  });
});
