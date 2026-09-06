/** Marketing display only. Stripe charges STRIPE_PREMIUM_PRICE_ID, not this label. */
export const PREMIUM_MONTHLY_PRICE_LABEL = "$7.99";
export const PREMIUM_MONTHLY_PRICE_DISPLAY = `${PREMIUM_MONTHLY_PRICE_LABEL} / month`;

export const BILLING_STATUS_QUERY_KEY = ["billing-status"] as const;

/** Bounded confirmation polling after Stripe Checkout redirect. */
export const BILLING_CONFIRM_POLL_MS = 1500;
export const BILLING_CONFIRM_MAX_ATTEMPTS = 8;

export const PREMIUM_BENEFITS = [
  "Automatic bank connections",
  "More accounts",
  "Longer forecasting windows",
  "Advanced planning tools",
  "Unlimited recurring automation",
] as const;

export const CHECKOUT_CONFIRMING_MESSAGE =
  "Payment received. Confirming your subscription…";
export const PREMIUM_ACTIVE_MESSAGE = "Premium is active.";
export const CHECKOUT_STILL_CONFIRMING_MESSAGE =
  "Your payment was received and your subscription is still being confirmed. Refresh shortly if your plan has not updated.";
export const CHECKOUT_CANCELED_MESSAGE =
  "Checkout canceled. No changes were made to your plan.";
export const BILLING_UNAVAILABLE_MESSAGE =
  "Billing is temporarily unavailable. Please try again later.";
export const ALREADY_PREMIUM_MESSAGE = "Your Premium subscription is already active.";
export const ACCESS_UNTIL_PERIOD_END_MESSAGE =
  "Your Premium features remain available until the end of the current billing period.";
