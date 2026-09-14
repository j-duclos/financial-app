import { UPGRADE_TO_PREMIUM_LABEL } from "@/lib/billing";

/** Marketing display only. Stripe charges STRIPE_PREMIUM_PRICE_ID, not this label. */
export const PREMIUM_SHEET_TITLE = "FlowSight Premium";
export const PREMIUM_MONTHLY_PRICE_LABEL = "$4.99/month";
export const PREMIUM_UPGRADE_CTA_LABEL = `Upgrade to Premium — ${PREMIUM_MONTHLY_PRICE_LABEL}`;
export const PREMIUM_NOT_NOW_LABEL = "Not now";
export const MANAGE_SUBSCRIPTION_LABEL = "Manage subscription";
export const PREMIUM_VIEW_PLAN_LABEL = "View plan";

/** Entry-point button copy. Never show a Stripe purchase CTA when purchase is unavailable. */
export function premiumRequiredActionLabel(purchaseAvailable: boolean): string {
  return purchaseAvailable ? UPGRADE_TO_PREMIUM_LABEL : PREMIUM_VIEW_PLAN_LABEL;
}

export const PREMIUM_BENEFITS = [
  "Automatic bank syncing",
  "365-day forecasts",
  "Unlimited manual accounts and recurring rules",
  "Advanced reports",
  "Full Payment Planner",
] as const;

export const PREMIUM_UPGRADE_CONTEXT = {
  accounts: "Want to add another account?",
  forecast: "See your cash flow further ahead.",
  bankSync: "Connect your banks automatically.",
  recurring: "Create unlimited recurring rules with Premium.",
  goals: "Create unlimited goals with Premium.",
  reports: "Unlock advanced reports and trends.",
  paymentPlanner: "Unlock full payment planning.",
} as const;

export const PREMIUM_DISCOVERY_SUBTITLE =
  "Automatic bank sync, longer forecasts, and advanced planning";

export const ACCOUNTS_BANK_SYNC_TEASER = "Automatic bank syncing with Premium";
export const ACCOUNTS_LIMIT_TEASER =
  "Upgrade for unlimited manual accounts and automatic bank syncing";
export const ACCOUNTS_LIMIT_TEASER_UNAVAILABLE =
  "Unlimited manual accounts and automatic bank syncing are available with Premium.";

export function accountsLimitTeaser(purchaseAvailable: boolean): string {
  return purchaseAvailable ? ACCOUNTS_LIMIT_TEASER : ACCOUNTS_LIMIT_TEASER_UNAVAILABLE;
}

export const PREMIUM_SUBSCRIPTION_NAME = "FlowSight Premium";
export const PREMIUM_BILLING_PERIOD_LABEL = "Monthly";
export const PREMIUM_PRICE_SOURCE_STRIPE =
  "Price shown is the current Stripe subscription display price for web and Android.";
export const PREMIUM_PRICE_SOURCE_APPLE =
  "When App Store purchases are available, price and period come from Apple, not this app.";
export const PREMIUM_AUTO_RENEW_STATEMENT =
  "Subscriptions renew automatically until canceled.";
export const PREMIUM_CANCEL_STATEMENT_STRIPE =
  "Manage or cancel in the Stripe billing portal after purchase.";
export const PREMIUM_CANCEL_STATEMENT_APPLE =
  "When App Store purchases are available, manage or cancel in Apple subscription settings.";
export const PREMIUM_MANAGEMENT_UNAVAILABLE_MESSAGE =
  "Premium subscription management is not available in this version.";
export const PREMIUM_LEGAL_LINKS_PREFIX = "See the ";
export const REGISTER_LEGAL_ACKNOWLEDGEMENT_PREFIX = "By creating an account, you agree to the ";
export const REGISTER_LEGAL_ACKNOWLEDGEMENT_AND = " and ";
export const TERMS_OF_SERVICE_LABEL = "Terms of Service";
export const PRIVACY_POLICY_LABEL = "Privacy Policy";
