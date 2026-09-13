/** Marketing display only. Stripe charges STRIPE_PREMIUM_PRICE_ID, not this label. */
export const PREMIUM_SHEET_TITLE = "FlowSight Premium";
export const PREMIUM_MONTHLY_PRICE_LABEL = "$4.99/month";
export const PREMIUM_UPGRADE_CTA_LABEL = `Upgrade to Premium — ${PREMIUM_MONTHLY_PRICE_LABEL}`;
export const PREMIUM_NOT_NOW_LABEL = "Not now";
export const MANAGE_SUBSCRIPTION_LABEL = "Manage subscription";

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
