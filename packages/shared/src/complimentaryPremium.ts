import type { BillingStatus } from "./types";
import { formatFullDate } from "./dateDisplay";

export const COMPLIMENTARY_PREMIUM_LABEL = "Complimentary Premium";
export const COMPLIMENTARY_ACCESS_LABEL = "Complimentary access";

const PAID_STRIPE_STATUSES = new Set(["active", "trialing"]);

export function hasComplimentaryPremium(billing: BillingStatus | null | undefined): boolean {
  return billing?.complimentary_premium === true;
}

export function stripeStatusGrantsPremium(status: string | null | undefined): boolean {
  return PAID_STRIPE_STATUSES.has((status || "").trim().toLowerCase());
}

/** Stripe portal only when a paid/real Stripe subscription exists, not complimentary-only. */
export function canManageStripeSubscription(billing: BillingStatus | null | undefined): boolean {
  if (!billing?.has_stripe_customer) return false;
  if (hasComplimentaryPremium(billing) && !stripeStatusGrantsPremium(billing.status)) {
    return false;
  }
  return true;
}

export function complimentaryPremiumUntilCopy(
  billing: BillingStatus | null | undefined
): string | null {
  if (!hasComplimentaryPremium(billing)) return null;
  const date = formatFullDate(billing?.complimentary_premium_until);
  return date ? `Active through ${date}` : null;
}
