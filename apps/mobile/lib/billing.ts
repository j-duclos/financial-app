import { ApiError } from "@budget-app/api-client";

export const BILLING_STATUS_QUERY_KEY = ["billing-status"] as const;
export const ONBOARDING_STATUS_QUERY_KEY = ["onboarding", "status"] as const;

export const EMAIL_VERIFICATION_REQUIRED_CODE = "email_verification_required";
export const EMAIL_VERIFICATION_REQUIRED_MESSAGE = "Verify your email before subscribing.";
export const EMAIL_VERIFY_BEFORE_UPGRADE_TITLE = "Verify your email";
export const EMAIL_VERIFY_BEFORE_UPGRADE_MESSAGE =
  "Verify your email before upgrading to FlowSight Premium.";
export const RESEND_VERIFICATION_EMAIL_LABEL = "Resend verification email";
export const BILLING_UNAVAILABLE_MESSAGE =
  "Billing is temporarily unavailable. Please try again later.";
export const ALREADY_PREMIUM_MESSAGE = "Your Premium subscription is already active.";
export const BANK_SYNC_WEB_MESSAGE =
  "Automatic bank syncing is available on the web app. You can add accounts manually here.";
export const UPGRADE_TO_PREMIUM_LABEL = "Upgrade to Premium";

export function isEmailVerificationRequiredError(err: unknown): boolean {
  if (!(err instanceof ApiError)) return false;
  if (err.code === EMAIL_VERIFICATION_REQUIRED_CODE) return true;
  return err.status === 403 && /verify your email before subscribing/i.test(err.message ?? "");
}

