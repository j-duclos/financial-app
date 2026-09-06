import { ApiError } from "@budget-app/api-client";
import type { BillingPlan, BillingStatus } from "@budget-app/shared";
import { formatFullDate } from "./dateDisplay";
import {
  ACCESS_UNTIL_PERIOD_END_MESSAGE,
  ALREADY_PREMIUM_MESSAGE,
  BILLING_UNAVAILABLE_MESSAGE,
  EMAIL_VERIFICATION_REQUIRED_CODE,
  EMAIL_VERIFICATION_REQUIRED_MESSAGE,
} from "./billing";

const STATUS_LABELS: Record<string, string> = {
  active: "Active",
  trialing: "Trial",
  past_due: "Payment issue",
  unpaid: "Payment required",
  canceled: "Canceled",
  incomplete: "Subscription setup incomplete",
  incomplete_expired: "Subscription setup incomplete",
  paused: "Subscription paused",
  inactive: "Free plan",
};

export function planLabel(plan: BillingPlan | string | undefined): string {
  return plan === "PREMIUM" ? "Premium" : "Free";
}

export function subscriptionStatusLabel(status: string | null | undefined): string {
  const key = (status || "").trim().toLowerCase();
  if (!key) return "Free plan";
  return STATUS_LABELS[key] ?? "Subscription update needed";
}

export function billingStatusLabel(billing: Pick<BillingStatus, "is_premium" | "status">): string {
  if (!billing.is_premium && (billing.status === "inactive" || !billing.status)) {
    return "Free plan";
  }
  return subscriptionStatusLabel(billing.status);
}

export function formatBillingPeriodEnd(iso: string | null | undefined): string | null {
  return formatFullDate(iso);
}

export function premiumPeriodCopy(billing: BillingStatus): {
  label: string;
  date: string | null;
  cancelNotice: string | null;
} | null {
  if (!billing.is_premium) return null;
  const date = formatBillingPeriodEnd(billing.current_period_end);
  if (!date) return null;
  if (billing.cancel_at_period_end) {
    return {
      label: "Premium access ends",
      date,
      cancelNotice: ACCESS_UNTIL_PERIOD_END_MESSAGE,
    };
  }
  return {
    label: "Next billing date",
    date,
    cancelNotice: null,
  };
}

export function isEmailVerificationRequiredError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const err = error as { code?: string; status?: number; message?: string };
  if (err.code === EMAIL_VERIFICATION_REQUIRED_CODE) return true;
  return err.status === 403 && /verify your email before subscribing/i.test(err.message ?? "");
}

export function billingActionErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 409) return ALREADY_PREMIUM_MESSAGE;
    if (isEmailVerificationRequiredError(error)) return EMAIL_VERIFICATION_REQUIRED_MESSAGE;
    const msg = error.message || "";
    if (
      error.status === 503 ||
      /not configured/i.test(msg) ||
      /STRIPE_|SECRET|whsec_|sk_live|sk_test/i.test(msg)
    ) {
      return BILLING_UNAVAILABLE_MESSAGE;
    }
    return msg || BILLING_UNAVAILABLE_MESSAGE;
  }
  if (error instanceof Error && error.message) return error.message;
  return "Something went wrong. Please try again.";
}

export function redirectToExternalUrl(url: string): void {
  window.location.assign(url);
}
