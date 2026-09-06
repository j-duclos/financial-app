/** Marketing display only. Stripe charges STRIPE_PREMIUM_PRICE_ID, not this label. */
export const PREMIUM_MONTHLY_PRICE_LABEL = "$7.99";
export const PREMIUM_MONTHLY_PRICE_DISPLAY = `${PREMIUM_MONTHLY_PRICE_LABEL} / month`;

export const BILLING_STATUS_QUERY_KEY = ["billing-status"] as const;

/** Bounded confirmation polling after Stripe Checkout redirect. */
export const BILLING_CONFIRM_POLL_MS = 1500;
export const BILLING_CONFIRM_MAX_ATTEMPTS = 8;

export const PREMIUM_BENEFITS = [
  "Automatic bank syncing",
  "Unlimited manually managed accounts",
  "Unlimited recurring automation",
  "Forecast planning up to 365 days",
  "Unlimited goals",
  "Advanced planning and reporting",
] as const;

export const FREE_PLAN_LIMITS = {
  linked_institutions: 0,
  manual_accounts: 3,
  recurring_rules: 10,
  operational_forecast_days: 90,
  goals: 2,
} as const;

export const PREMIUM_PLAN_FORECAST_DAYS = 365;

export const PLAID_PREMIUM_MESSAGE = "Automatic bank syncing is a Premium feature.";
export const PLAID_SYNC_PAUSED_MESSAGE =
  "Automatic bank syncing is paused because this account is on the Free plan.";
export const PLAID_PREMIUM_DESCRIPTION =
  "Connect your banks and automatically keep transactions up to date.";

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
export const EMAIL_VERIFICATION_REQUIRED_CODE = "email_verification_required";
export const EMAIL_VERIFICATION_REQUIRED_MESSAGE = "Verify your email before subscribing.";
export const ACCESS_UNTIL_PERIOD_END_MESSAGE =
  "Your Premium features remain available until the end of the current billing period.";
