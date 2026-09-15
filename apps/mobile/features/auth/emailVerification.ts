import { hasProfileEmail, RESEND_VERIFICATION_SUCCESS } from "@/features/profile/profileSettings";

export const ACCOUNT_CREATED_TITLE = "Account created";
export const VERIFY_EMAIL_TITLE = "Verify your email";
export const CONTINUE_LABEL = "Continue";
export const RESEND_EMAIL_LABEL = "Resend email";
export const REFRESH_STATUS_LABEL = "Refresh status";
export const EMAIL_VERIFIED_ALERT_TITLE = "Email verified";
export const EMAIL_STILL_UNVERIFIED_MESSAGE =
  "Still waiting for verification. Open the link in your email, then try again.";

export function accountCreatedBody(email: string): string {
  return `We sent a verification email to ${email}. You can start using FlowSight now, but you'll need to verify your email before using Premium billing and certain account actions.`;
}

export function verifyEmailReminderBody(email: string): string {
  return `We sent a verification link to ${email}. Verify your email to secure your account and enable Premium billing and other protected account actions.`;
}

/** Home reminder: show only when there is an email and verification is explicitly false. */
export function shouldShowEmailVerificationReminder(profile: {
  email?: string | null;
  email_verified?: boolean;
} | null | undefined): boolean {
  if (!profile) return false;
  if (!hasProfileEmail(profile.email)) return false;
  return profile.email_verified === false;
}

export function requestVerificationEmailDetail(detail: string | undefined): string {
  const trimmed = detail?.trim() ?? "";
  return trimmed || RESEND_VERIFICATION_SUCCESS;
}

export async function requestVerificationEmailResend(
  send: () => Promise<{ detail: string }>
): Promise<string> {
  const result = await send();
  return requestVerificationEmailDetail(result.detail);
}

export function refreshVerificationAlert(emailVerified: boolean): { title: string; message?: string } {
  if (emailVerified) {
    return { title: EMAIL_VERIFIED_ALERT_TITLE };
  }
  return { title: EMAIL_STILL_UNVERIFIED_MESSAGE };
}
